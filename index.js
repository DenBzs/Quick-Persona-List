/**
 * Quick Persona List Extension
 * - Bottom bar button: shows current persona avatar
 * - Click → vertical list of favorited personas
 * - Each row: [avatar] [name] [title tag] [⭐ favorite] [📌 lock to chat]
 * - Star button: toggle favorite
 * - Pin button: lock/unlock persona to current chat
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
import { extensionSettings, saveSettingsDebounced } from '../../../extensions.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const MODULE_NAME = 'Quick-Persona-List';

const supportsPersonaThumbnails = getThumbnailUrl('persona', 'test.png', true).includes('&t=');

// ─── State ────────────────────────────────────────────────────────────────────
/** @type {Popper.Instance | null} */
let popper = null;
let isOpen = false;
let allAvatarsCache = null;
let $menuContent = null;
let showAllExpanded = false; // remember if "전체 목록" section is open

// ─── Settings (favorites stored globally) ────────────────────────────────────
function getSettings() {
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = { favorites: [] };
    }
    if (!Array.isArray(extensionSettings[MODULE_NAME].favorites)) {
        extensionSettings[MODULE_NAME].favorites = [];
    }
    return extensionSettings[MODULE_NAME];
}

function isFavorite(avatarId) {
    return getSettings().favorites.includes(avatarId);
}

function toggleFavorite(avatarId) {
    const settings = getSettings();
    const idx = settings.favorites.indexOf(avatarId);
    if (idx >= 0) {
        settings.favorites.splice(idx, 1);
    } else {
        settings.favorites.push(avatarId);
    }
    saveSettingsDebounced();
}

// ─── Chat lock helpers ────────────────────────────────────────────────────────
function getLockedPersona() {
    try {
        return chatMetadata?.['persona'] ?? null;
    } catch {
        return null;
    }
}

async function toggleLockPersona(avatarId) {
    try {
        const currentLock = getLockedPersona();
        if (currentLock === avatarId) {
            // Unlock
            delete chatMetadata['persona'];
            toastr.info('페르소나 고정을 해제했습니다.');
        } else {
            chatMetadata['persona'] = avatarId;
            // Also switch to this persona immediately
            await setUserAvatar(avatarId);
            changeQuickPersona();
            toastr.success(`"${power_user.personas[avatarId] || avatarId}" 페르소나를 채팅방에 고정했습니다.`);
        }
        await saveMetadata();
        // Re-render lock buttons without full rebuild
        refreshLockButtons();
    } catch (err) {
        console.error('[QuickPersonaList] Lock error:', err);
        toastr.error('채팅 고정에 실패했습니다. 채팅이 열려있는지 확인하세요.');
    }
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
    const html = `
    <div id="quickPersona" class="interactable" tabindex="0" title="페르소나 선택">
        <img id="quickPersonaImg" src="/img/ai4.png" alt="persona" />
        <div id="quickPersonaCaret" class="fa-fw fa-solid fa-caret-up"></div>
    </div>`;
    $('#leftSendForm').append(html);
    $('#quickPersona').on('click', () => toggleQuickPersonaSelector());
}

function changeQuickPersona() {
    setTimeout(() => {
        const name = power_user.personas?.[user_avatar] || user_avatar;
        const title = power_user.persona_descriptions?.[user_avatar]?.title || '';
        const imgUrl = getImageUrl(user_avatar);
        const tooltip = title ? `${name} — ${title}` : name;
        $('#quickPersonaImg').attr('src', imgUrl).attr('title', tooltip);
    }, 100);
}

// ─── Menu toggle ──────────────────────────────────────────────────────────────
async function toggleQuickPersonaSelector() {
    if (isOpen) {
        closeQuickPersonaSelector();
    } else {
        await openQuickPersonaSelector();
    }
}

// ─── Open menu ────────────────────────────────────────────────────────────────
async function openQuickPersonaSelector() {
    isOpen = true;
    showAllExpanded = false;

    // Fetch all avatars (cached for re-renders within this open session)
    allAvatarsCache = await getUserAvatars(false);

    const $menu = $(`
        <div id="quickPersonaMenu">
            <div class="qpl-header">
                <span><i class="fa-solid fa-user-circle"></i> 페르소나</span>
            </div>
            <div class="qpl-content"></div>
        </div>
    `);
    $menuContent = $menu.find('.qpl-content');

    $menu.hide();
    $(document.body).append($menu);
    $('#quickPersonaCaret').removeClass('fa-caret-up').addClass('fa-caret-down');

    renderMenuContent();

    $menu.fadeIn(animation_duration);
    popper = Popper.createPopper(
        document.getElementById('quickPersona'),
        document.getElementById('quickPersonaMenu'),
        { placement: 'top-start', modifiers: [{ name: 'offset', options: { offset: [0, 6] } }] },
    );
    popper.update();
}

// ─── Render menu content (called on open & after favorite toggle) ─────────────
function renderMenuContent() {
    if (!$menuContent || !allAvatarsCache) return;
    $menuContent.empty();

    const favorites = getSettings().favorites;
    const favAvatars = allAvatarsCache.filter(a => favorites.includes(a));
    const nonFavAvatars = allAvatarsCache.filter(a => !favorites.includes(a));

    // ── Favorites section ──
    if (favAvatars.length > 0) {
        const $section = $('<div class="qpl-section"></div>');
        $section.append('<div class="qpl-section-label"><i class="fa-solid fa-star"></i> 즐겨찾기</div>');
        favAvatars.forEach(id => $section.append(createRow(id)));
        $menuContent.append($section);
    }

    // ── Non-favorites: collapsible ──
    if (nonFavAvatars.length > 0) {
        if (favAvatars.length > 0) {
            // Collapsible "전체 목록" below favorites
            const $toggle = $(`
                <button class="qpl-toggle-all">
                    전체 목록
                    <i class="fa-solid fa-chevron-${showAllExpanded ? 'up' : 'down'}"></i>
                </button>`);
            const $allSection = $('<div class="qpl-all-section"></div>');
            if (!showAllExpanded) $allSection.hide();
            nonFavAvatars.forEach(id => $allSection.append(createRow(id)));

            $toggle.on('click', () => {
                showAllExpanded = !showAllExpanded;
                $allSection.slideToggle(200);
                $toggle.find('i').attr('class', `fa-solid fa-chevron-${showAllExpanded ? 'up' : 'down'}`);
            });

            $menuContent.append($toggle);
            $menuContent.append($allSection);
        } else {
            // No favorites yet → show all with a hint
            const $hint = $('<div class="qpl-hint"><i class="fa-regular fa-star"></i> ⭐ 눌러서 즐겨찾기 추가</div>');
            const $section = $('<div class="qpl-section"></div>');
            allAvatarsCache.forEach(id => $section.append(createRow(id)));
            $menuContent.append($hint);
            $menuContent.append($section);
        }
    }

    if (allAvatarsCache.length === 0) {
        $menuContent.append('<div class="qpl-hint">페르소나가 없습니다.</div>');
    }

    if (popper) popper.update();
}

// ─── Single persona row ───────────────────────────────────────────────────────
function createRow(avatarId) {
    const name = power_user.personas?.[avatarId] || avatarId;
    const title = power_user.persona_descriptions?.[avatarId]?.title || '';
    const imgUrl = getImageUrl(avatarId);
    const isSelected = avatarId === user_avatar;
    const isDefault = avatarId === power_user.default_persona;
    const fav = isFavorite(avatarId);
    const locked = getLockedPersona() === avatarId;

    const $row = $(`
        <div class="qpl-row${isSelected ? ' qpl-selected' : ''}" data-avatar="${avatarId}">
            <div class="qpl-avatar-wrap">
                <img class="qpl-avatar${isDefault ? ' qpl-default' : ''}" src="${imgUrl}" alt="${name}" />
            </div>
            <div class="qpl-info">
                <span class="qpl-name">${DOMPurify.sanitize(name)}</span>
                ${title ? `<span class="qpl-title-tag">${DOMPurify.sanitize(title)}</span>` : ''}
            </div>
            <div class="qpl-actions">
                <button class="qpl-btn qpl-fav-btn${fav ? ' active' : ''}"
                        title="${fav ? '즐겨찾기 해제' : '즐겨찾기 추가'}">
                    <i class="fa-${fav ? 'solid' : 'regular'} fa-star"></i>
                </button>
                <button class="qpl-btn qpl-lock-btn${locked ? ' active' : ''}"
                        title="${locked ? '채팅방 고정 해제' : '채팅방에 고정'}">
                    <i class="fa-${locked ? 'solid' : 'regular'} fa-thumbtack"></i>
                </button>
            </div>
        </div>
    `);

    // Click avatar or name/title → apply persona & close
    $row.find('.qpl-avatar-wrap, .qpl-info').on('click', async () => {
        closeQuickPersonaSelector();
        await setUserAvatar(avatarId);
        changeQuickPersona();
    });

    // ⭐ Favorite toggle (re-render in place)
    $row.find('.qpl-fav-btn').on('click', e => {
        e.stopPropagation();
        toggleFavorite(avatarId);
        renderMenuContent(); // re-render entire list
    });

    // 📌 Lock to chat
    $row.find('.qpl-lock-btn').on('click', async e => {
        e.stopPropagation();
        await toggleLockPersona(avatarId);
    });

    return $row;
}

// ─── Refresh only lock button states (no full re-render) ─────────────────────
function refreshLockButtons() {
    const locked = getLockedPersona();
    $('#quickPersonaMenu .qpl-row').each(function () {
        const avatarId = $(this).data('avatar');
        const isLocked = locked === avatarId;
        const $btn = $(this).find('.qpl-lock-btn');
        $btn.toggleClass('active', isLocked);
        $btn.attr('title', isLocked ? '채팅방 고정 해제' : '채팅방에 고정');
        $btn.find('i').attr('class', `fa-${isLocked ? 'solid' : 'regular'} fa-thumbtack`);
    });
}

// ─── Close menu ───────────────────────────────────────────────────────────────
function closeQuickPersonaSelector() {
    if (!isOpen) return;
    isOpen = false;
    allAvatarsCache = null;
    $menuContent = null;

    $('#quickPersonaCaret').removeClass('fa-caret-down').addClass('fa-caret-up');
    $('#quickPersonaMenu').fadeOut(animation_duration, () => {
        $('#quickPersonaMenu').remove();
    });
    if (popper) {
        popper.destroy();
        popper = null;
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
jQuery(() => {
    getSettings(); // ensure settings object exists

    addQuickPersonaButton();

    eventSource.on(event_types.CHAT_CHANGED, changeQuickPersona);
    eventSource.on(event_types.SETTINGS_UPDATED, changeQuickPersona);

    // Close menu when clicking outside
    $(document.body).on('click', e => {
        if (
            isOpen &&
            !e.target.closest('#quickPersonaMenu') &&
            !e.target.closest('#quickPersona')
        ) {
            closeQuickPersonaSelector();
        }
    });

    changeQuickPersona();
});
