/**
 * Quick-Persona-List
 *
 * • Bottom bar: shows current persona avatar (same button as original QuickPersona)
 * • Click button → dropdown of FAVORITED personas only
 *   - Each row: [avatar] [name] [title tag] [📌 lock-to-chat button]
 *   - If no favorites yet → show all personas with a hint
 * • ⭐ Favorite button injected into ST's built-in persona management panel
 *   - Uses MutationObserver to detect when the panel opens and injects stars
 */

import {
    animation_duration,
    eventSource,
    event_types,
    getThumbnailUrl,
    chatMetadata,
    saveMetadata,
} from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import {
    getUserAvatar,
    getUserAvatars,
    setUserAvatar,
    user_avatar,
} from '../../../personas.js';
import { Popper } from '../../../../lib.js';

// ─── Module identity ──────────────────────────────────────────────────────────
const MODULE_NAME = 'Quick-Persona-List';

// ─── Globals ──────────────────────────────────────────────────────────────────
const supportsPersonaThumbnails = getThumbnailUrl('persona', 'test.png', true).includes('&t=');
/** @type {Popper.Instance|null} */
let popper = null;
let isOpen = false;

// ─── Settings: favorites stored in extensionSettings ─────────────────────────
function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = { favorites: [] };
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    if (!Array.isArray(s.favorites)) s.favorites = [];
    return s;
}

function isFavorite(avatarId) {
    return getSettings().favorites.includes(avatarId);
}

function toggleFavorite(avatarId) {
    const s = getSettings();
    const idx = s.favorites.indexOf(avatarId);
    if (idx >= 0) {
        s.favorites.splice(idx, 1);
    } else {
        s.favorites.push(avatarId);
    }
    // saveSettingsDebounced is available via getContext
    SillyTavern.getContext().saveSettingsDebounced();
}

// ─── Image URL ────────────────────────────────────────────────────────────────
function getImageUrl(avatarId) {
    if (supportsPersonaThumbnails) {
        return getThumbnailUrl('persona', avatarId, true);
    }
    return `${getUserAvatar(avatarId)}?t=${Date.now()}`;
}

// ─── Bottom bar button ────────────────────────────────────────────────────────
function addQuickPersonaButton() {
    // Don't add twice
    if ($('#quickPersona').length) return;

    const html = `
    <div id="quickPersona" class="interactable" tabindex="0" title="페르소나 목록 열기">
        <img id="quickPersonaImg" src="/img/ai4.png" alt="persona" />
        <div id="quickPersonaCaret" class="fa-fw fa-solid fa-caret-up"></div>
    </div>`;
    $('#leftSendForm').append(html);
    $('#quickPersona').on('click', () => toggleQuickPersonaSelector());
}

function changeQuickPersona() {
    setTimeout(() => {
        const name  = power_user.personas?.[user_avatar] || user_avatar;
        const title = power_user.persona_descriptions?.[user_avatar]?.title || '';
        const imgUrl  = getImageUrl(user_avatar);
        const tooltip = title ? `${name} — ${title}` : name;
        $('#quickPersonaImg').attr('src', imgUrl).attr('title', tooltip);

        // Golden ring on button when this persona is locked to current chat
        const locked = chatMetadata?.['persona'];
        $('#quickPersona').toggleClass('qpl-chat-locked', !!locked && locked === user_avatar);
    }, 100);
}

// ─── Menu toggle ──────────────────────────────────────────────────────────────
async function toggleQuickPersonaSelector() {
    if (isOpen) {
        closeMenu();
    } else {
        await openMenu();
    }
}

// ─── Open menu ────────────────────────────────────────────────────────────────
async function openMenu() {
    isOpen = true;
    const allAvatars = await getUserAvatars(false);
    const favorites  = getSettings().favorites;
    const showList   = favorites.length > 0
        ? allAvatars.filter(id => favorites.includes(id))
        : allAvatars; // show everything when no favorites set

    const $menu = $(`
        <div id="qplMenu">
            <div class="qpl-header">
                <i class="fa-solid fa-user"></i>
                페르소나${favorites.length === 0 ? ' (전체)' : ''}
            </div>
            <div class="qpl-list"></div>
            ${favorites.length === 0
                ? '<div class="qpl-hint"><i class="fa-regular fa-star"></i> 페르소나 관리 패널에서 ⭐를 눌러 즐겨찾기를 추가하세요.</div>'
                : ''}
        </div>
    `);

    const $list = $menu.find('.qpl-list');
    for (const id of showList) {
        $list.append(createRow(id));
    }

    $menu.hide();
    $(document.body).append($menu);
    $('#quickPersonaCaret').removeClass('fa-caret-up').addClass('fa-caret-down');
    $menu.fadeIn(animation_duration);

    popper = Popper.createPopper(
        document.getElementById('quickPersona'),
        document.getElementById('qplMenu'),
        { placement: 'top-start', modifiers: [{ name: 'offset', options: { offset: [0, 6] } }] },
    );
    popper.update();
}

// ─── Close menu ───────────────────────────────────────────────────────────────
function closeMenu() {
    if (!isOpen) return;
    isOpen = false;
    $('#quickPersonaCaret').removeClass('fa-caret-down').addClass('fa-caret-up');
    $('#qplMenu').fadeOut(animation_duration, () => $('#qplMenu').remove());
    if (popper) { popper.destroy(); popper = null; }
}

// ─── Single persona row ───────────────────────────────────────────────────────
function createRow(avatarId) {
    const { DOMPurify } = SillyTavern.libs;
    const name    = power_user.personas?.[avatarId] || avatarId;
    const title   = power_user.persona_descriptions?.[avatarId]?.title || '';
    const imgUrl  = getImageUrl(avatarId);
    const isActive  = avatarId === user_avatar;
    const isDefault = avatarId === power_user.default_persona;
    const locked  = chatMetadata?.['persona'] === avatarId;

    const $row = $(`
        <div class="qpl-row${isActive ? ' qpl-active' : ''}" data-avatar="${DOMPurify.sanitize(avatarId)}">
            <div class="qpl-avatar-wrap">
                <img class="qpl-avatar${isDefault ? ' qpl-default' : ''}"
                     src="${imgUrl}" alt="${DOMPurify.sanitize(name)}" />
            </div>
            <div class="qpl-info">
                <span class="qpl-name">${DOMPurify.sanitize(name)}</span>
                ${title ? `<span class="qpl-tag">${DOMPurify.sanitize(title)}</span>` : ''}
            </div>
            <button class="qpl-pin-btn${locked ? ' active' : ''}"
                    title="${locked ? '현재 채팅 고정 해제' : '현재 채팅에 고정'}">
                <i class="fa-${locked ? 'solid' : 'regular'} fa-thumbtack"></i>
            </button>
        </div>
    `);

    // Click avatar / name → switch persona
    $row.find('.qpl-avatar-wrap, .qpl-info').on('click', async () => {
        closeMenu();
        await setUserAvatar(avatarId);
        changeQuickPersona();
    });

    // 📌 Lock to chat
    $row.find('.qpl-pin-btn').on('click', async e => {
        e.stopPropagation();
        await toggleChatLock(avatarId);
        // Update pin button in place
        const nowLocked = chatMetadata?.['persona'] === avatarId;
        const $btn = $(e.currentTarget);
        $btn.toggleClass('active', nowLocked);
        $btn.attr('title', nowLocked ? '현재 채팅 고정 해제' : '현재 채팅에 고정');
        $btn.find('i').attr('class', `fa-${nowLocked ? 'solid' : 'regular'} fa-thumbtack`);
        changeQuickPersona();
    });

    return $row;
}

// ─── Chat lock ────────────────────────────────────────────────────────────────
async function toggleChatLock(avatarId) {
    try {
        if (chatMetadata?.['persona'] === avatarId) {
            delete chatMetadata['persona'];
            toastr.info('채팅방 페르소나 고정을 해제했습니다.');
        } else {
            chatMetadata['persona'] = avatarId;
            await setUserAvatar(avatarId);
            const name = power_user.personas?.[avatarId] || avatarId;
            toastr.success(`"${name}"을(를) 이 채팅방에 고정했습니다.`);
        }
        await saveMetadata();
    } catch (err) {
        console.error('[Quick-Persona-List] 채팅 고정 오류:', err);
        toastr.error('채팅 고정 실패. 채팅이 열려 있는지 확인하세요.');
    }
}

// ─── ⭐ Inject favorite stars into ST's persona management panel ───────────────
/**
 * ST renders persona items in the persona management section.
 * We look for list items that contain persona avatar thumbnails
 * and inject a ⭐ toggle button into each one.
 *
 * Selectors tried (in order):
 *   1. [data-avatar] — items with explicit avatar attribute
 *   2. #persona-management .avatar_container / .persona_select
 *   3. Any li.list-group-item inside a persona-related block
 *   4. Fallback: find imgs with persona thumbnail URLs and walk up to li parent
 */
function injectFavoriteStarsIntoPanel() {
    // Possible containers for the persona list
    const CONTAINER_SELECTORS = [
        '#persona-management',
        '#persona_management',
        '.persona-management',
        '#user-settings-block',
    ];

    // Possible item selectors within those containers
    const ITEM_SELECTORS = [
        '[data-avatar]',
        '.persona_select',
        '.avatar_container',
        'li.list-group-item',
    ];

    let $items = $();

    // Try container + item combos
    for (const container of CONTAINER_SELECTORS) {
        if (!$(container).length) continue;
        for (const item of ITEM_SELECTORS) {
            const found = $(`${container} ${item}`);
            if (found.length) { $items = found; break; }
        }
        if ($items.length) break;
    }

    // Absolute fallback: find persona thumbnail images anywhere in user settings,
    // then walk up to the nearest list item
    if (!$items.length) {
        const thumbSrc = `img[src*="type=persona"], img[src*="User%20Avatars"]`;
        $(`#user-settings-block ${thumbSrc}, #persona-management ${thumbSrc}`).each(function () {
            const $parent = $(this).closest('li, [class*="persona"], [class*="avatar"]');
            if ($parent.length) $items = $items.add($parent);
        });
    }

    if (!$items.length) {
        // Nothing found — panel not open or selectors don't match.
        // Will retry via MutationObserver.
        return;
    }

    $items.each(function () {
        const $item = $(this);
        if ($item.find('.qpl-fav-star').length) return; // already injected

        // Determine avatarId:
        // 1. data-avatar attribute
        let avatarId = $item.data('avatar') || $item.attr('data-avatar');

        // 2. Parse from thumbnail URL in child img
        if (!avatarId) {
            const src = $item.find('img').first().attr('src') || '';
            const m = src.match(/[?&]file=([^&]+)/);
            if (m) avatarId = decodeURIComponent(m[1]);
        }

        // 3. Try name from sibling text or data-name
        if (!avatarId) avatarId = $item.data('name') || null;

        if (!avatarId) return;

        const fav = isFavorite(avatarId);
        const $star = $(`
            <button class="qpl-fav-star${fav ? ' active' : ''}"
                    title="${fav ? '즐겨찾기 해제' : '즐겨찾기 추가'}"
                    data-avatar="${avatarId}">
                <i class="fa-${fav ? 'solid' : 'regular'} fa-star"></i>
            </button>
        `);

        $star.on('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            const id  = $(this).data('avatar');
            toggleFavorite(id);
            const now = isFavorite(id);
            $(this).toggleClass('active', now);
            $(this).attr('title', now ? '즐겨찾기 해제' : '즐겨찾기 추가');
            $(this).find('i').attr('class', `fa-${now ? 'solid' : 'regular'} fa-star`);
        });

        $item.css('position', 'relative').append($star);
    });
}

// Watch the DOM for the persona panel opening
function setupPanelObserver() {
    const observer = new MutationObserver(() => {
        // Only run injection when user-settings area has changed
        injectFavoriteStarsIntoPanel();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Also fire when user avatar button is clicked (persona panel opens)
    $(document).on('click', '#your-profileImage, .user-settings-icon, [data-panel="user-settings"]', () => {
        setTimeout(injectFavoriteStarsIntoPanel, 300);
    });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
jQuery(() => {
    getSettings(); // ensure settings object initialised

    addQuickPersonaButton();
    setupPanelObserver();

    eventSource.on(event_types.CHAT_CHANGED, changeQuickPersona);
    eventSource.on(event_types.SETTINGS_UPDATED, changeQuickPersona);

    // Close dropdown when clicking outside
    $(document.body).on('click', e => {
        if (isOpen && !e.target.closest('#qplMenu') && !e.target.closest('#quickPersona')) {
            closeMenu();
        }
    });

    changeQuickPersona();
});
