/**
 * Quick-Persona-List
 *
 * ⚠️ 원본 Extension-QuickPersona와 동시 사용 불가 — 비활성화 후 사용하세요.
 */

import { animation_duration, eventSource, event_types, getThumbnailUrl } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { getUserAvatar, getUserAvatars, setUserAvatar, user_avatar } from '../../../personas.js';
import { Popper } from '../../../../lib.js';

const MODULE_NAME = 'Quick-Persona-List';
const supportsPersonaThumbnails = getThumbnailUrl('persona', 'test.png', true).includes('&t=');

/** @type {Popper.Instance|null} */
let popper = null;
let isOpen = false;

// ─── Settings ─────────────────────────────────────────────────────────────────
// favorites: string[]        — 즐겨찾기 avatarId 목록
// customOrder: string[]|null — 수동 정렬 순서 (null이면 이름순)
function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = { favorites: [], customOrder: null };
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    if (!Array.isArray(s.favorites)) s.favorites = [];
    // customOrder: null = 이름순, array = 수동순서
    if (s.customOrder !== null && !Array.isArray(s.customOrder)) s.customOrder = null;
    return s;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

function isFavorite(avatarId) {
    return getSettings().favorites.includes(avatarId);
}

function toggleFavorite(avatarId) {
    const s = getSettings();
    const idx = s.favorites.indexOf(avatarId);
    if (idx >= 0) {
        s.favorites.splice(idx, 1);
        // customOrder에서도 제거
        if (Array.isArray(s.customOrder)) {
            s.customOrder = s.customOrder.filter(id => id !== avatarId);
        }
    } else {
        s.favorites.push(avatarId);
        // customOrder가 있으면 끝에 추가
        if (Array.isArray(s.customOrder)) {
            s.customOrder.push(avatarId);
        }
    }
    saveSettings();
}

// ─── 정렬 ─────────────────────────────────────────────────────────────────────
function isCustomOrder() {
    return Array.isArray(getSettings().customOrder);
}

function getSortedFavorites(allAvatars) {
    const s = getSettings();
    const favSet = new Set(s.favorites);
    const favAvatars = allAvatars.filter(id => favSet.has(id));

    if (isCustomOrder()) {
        // customOrder 순서 기준, customOrder에 없는 건 뒤에 붙임
        const order = s.customOrder;
        return [
            ...order.filter(id => favSet.has(id)),
            ...favAvatars.filter(id => !order.includes(id)),
        ];
    } else {
        // 이름순
        return favAvatars.sort((a, b) => {
            const na = (power_user.personas?.[a] || a).toLowerCase();
            const nb = (power_user.personas?.[b] || b).toLowerCase();
            return na.localeCompare(nb, 'ko');
        });
    }
}

// 수동 정렬 모드로 전환 (현재 이름순 순서를 초기값으로)
function enableCustomOrder(currentList) {
    const s = getSettings();
    s.customOrder = [...currentList];
    saveSettings();
}

// 이름순으로 되돌리기
function disableCustomOrder() {
    const s = getSettings();
    s.customOrder = null;
    saveSettings();
}

// 수동 정렬 모드에서 항목 이동
function moveItem(avatarId, direction) { // direction: -1(위) or +1(아래)
    const s = getSettings();
    if (!Array.isArray(s.customOrder)) return;
    const order = s.customOrder;
    const idx = order.indexOf(avatarId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= order.length) return;
    // swap
    [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
    saveSettings();
}

// ─── 채팅 고정 ─────────────────────────────────────────────────────────────────
function getLockedPersona() {
    try { return SillyTavern.getContext().chatMetadata?.['persona'] ?? null; }
    catch { return null; }
}

async function toggleChatLock(avatarId) {
    try {
        const ctx  = SillyTavern.getContext();
        const meta = ctx.chatMetadata;
        if (!meta) { toastr.warning('채팅이 열려있지 않습니다.'); return; }
        const isLocked = meta['persona'] === avatarId;
        if (isLocked) {
            delete meta['persona'];
            toastr.info('채팅방 페르소나 고정을 해제했습니다.');
        } else {
            meta['persona'] = avatarId;
            await setUserAvatar(avatarId);
            const name = power_user.personas?.[avatarId] || avatarId;
            toastr.success(`"${name}"을(를) 이 채팅방에 고정했습니다.`);
        }
        if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
        updateButtonState();
    } catch (err) {
        console.error('[Quick-Persona-List] 채팅 고정 오류:', err);
        toastr.error('채팅 고정에 실패했습니다.');
    }
}

// ─── 이미지 URL ────────────────────────────────────────────────────────────────
function getImageUrl(avatarId) {
    if (supportsPersonaThumbnails) return getThumbnailUrl('persona', avatarId, true);
    return `${getUserAvatar(avatarId)}?t=${Date.now()}`;
}

// ─── 하단 버튼 ─────────────────────────────────────────────────────────────────
function addQuickPersonaButton() {
    if ($('#qplBtn').length) return;
    const $container = $('#leftSendForm').length ? $('#leftSendForm')
        : $('#send_form').length ? $('#send_form')
        : $('form#send_form, .sendForm, #form_sheld').first();
    if (!$container.length) {
        setTimeout(addQuickPersonaButton, 1000);
        return;
    }
    $container.append(`
        <div id="qplBtn" tabindex="0" title="페르소나 목록 열기">
            <img id="qplBtnImg" src="/img/ai4.png" alt="persona" />
            <div id="qplBtnCaret" class="fa-fw fa-solid fa-caret-up"></div>
        </div>
    `);
    $('#qplBtn').on('click', () => toggleMenu());
}

function updateButtonState() {
    setTimeout(() => {
        const name   = power_user.personas?.[user_avatar] || user_avatar;
        const title  = power_user.persona_descriptions?.[user_avatar]?.title || '';
        const imgUrl = getImageUrl(user_avatar);
        $('#qplBtnImg').attr('src', imgUrl).attr('title', title ? `${name} — ${title}` : name);
        const locked = getLockedPersona();
        $('#qplBtn').toggleClass('qpl-locked', !!locked && locked === user_avatar);
    }, 100);
}

// ─── 메뉴 ─────────────────────────────────────────────────────────────────────
async function toggleMenu() {
    if (isOpen) closeMenu(); else await openMenu();
}

async function openMenu() {
    isOpen = true;

    const allAvatars = await getUserAvatars(false);
    const s          = getSettings();
    const hasFavs    = s.favorites.length > 0;
    const listIds    = hasFavs ? getSortedFavorites(allAvatars) : allAvatars;
    const customMode = isCustomOrder();

    const $menu = $(`
        <div id="qplMenu">
            <div class="qpl-header">
                <span class="qpl-header-title">
                    <i class="fa-solid fa-user"></i>
                    페르소나${!hasFavs ? ' (전체)' : ''}
                </span>
                ${hasFavs ? `
                <button class="qpl-sort-btn${customMode ? ' active' : ''}"
                        title="${customMode ? '이름순으로 돌아가기' : '순서 직접 정하기'}">
                    <i class="fa-solid fa-${customMode ? 'arrow-down-a-z' : 'grip-lines'}"></i>
                    ${customMode ? '이름순' : '순서편집'}
                </button>` : ''}
            </div>
            <div class="qpl-list"></div>
            ${!hasFavs ? '<div class="qpl-hint"><i class="fa-regular fa-star"></i> 페르소나 패널에서 ⭐를 눌러 즐겨찾기를 추가하세요.</div>' : ''}
        </div>
    `);

    const $list = $menu.find('.qpl-list');
    listIds.forEach(id => $list.append(createRow(id, customMode)));

    // 정렬 토글 버튼
    $menu.find('.qpl-sort-btn').on('click', e => {
        e.stopPropagation();
        if (isCustomOrder()) {
            disableCustomOrder();
        } else {
            enableCustomOrder(listIds);
        }
        rebuildList();
    });

    $menu.hide();
    $(document.body).append($menu);
    $('#qplBtnCaret').removeClass('fa-caret-up').addClass('fa-caret-down');
    $menu.fadeIn(animation_duration);

    popper = Popper.createPopper(
        document.getElementById('qplBtn'),
        document.getElementById('qplMenu'),
        { placement: 'top-start', modifiers: [{ name: 'offset', options: { offset: [0, 6] } }] },
    );
    popper.update();
}

// 메뉴 열린 채로 목록만 다시 그리기
async function rebuildList() {
    const allAvatars = await getUserAvatars(false);
    const s          = getSettings();
    const hasFavs    = s.favorites.length > 0;
    const listIds    = hasFavs ? getSortedFavorites(allAvatars) : allAvatars;
    const customMode = isCustomOrder();

    const $list = $('#qplMenu .qpl-list');
    $list.empty();
    listIds.forEach(id => $list.append(createRow(id, customMode)));

    // 버튼 상태 갱신
    const $btn = $('#qplMenu .qpl-sort-btn');
    $btn.toggleClass('active', customMode)
        .attr('title', customMode ? '이름순으로 돌아가기' : '순서 직접 정하기')
        .html(`<i class="fa-solid fa-${customMode ? 'arrow-down-a-z' : 'grip-lines'}"></i> ${customMode ? '이름순' : '순서편집'}`);

    if (popper) popper.update();
}

function closeMenu() {
    if (!isOpen) return;
    isOpen = false;
    $('#qplBtnCaret').removeClass('fa-caret-down').addClass('fa-caret-up');
    $('#qplMenu').fadeOut(animation_duration, () => $('#qplMenu').remove());
    if (popper) { popper.destroy(); popper = null; }
}

// ─── 행 생성 ──────────────────────────────────────────────────────────────────
function createRow(avatarId, customMode = false) {
    const { DOMPurify } = SillyTavern.libs;
    const name      = power_user.personas?.[avatarId] || avatarId;
    const title     = power_user.persona_descriptions?.[avatarId]?.title || '';
    const imgUrl    = getImageUrl(avatarId);
    const isActive  = avatarId === user_avatar;
    const isDefault = avatarId === power_user.default_persona;
    const locked    = getLockedPersona() === avatarId;

    const safeId    = DOMPurify.sanitize(avatarId);
    const safeName  = DOMPurify.sanitize(name);
    const safeTitle = DOMPurify.sanitize(title);

    const $row = $(`
        <div class="qpl-row${isActive ? ' qpl-active' : ''}${customMode ? ' qpl-reorder-mode' : ''}" data-avatar="${safeId}">
            <div class="qpl-avatar-wrap">
                <img class="qpl-avatar${isDefault ? ' qpl-default' : ''}" src="${imgUrl}" alt="${safeName}" />
            </div>
            <div class="qpl-info">
                <span class="qpl-name">${safeName}</span>
                ${safeTitle ? `<span class="qpl-tag">${safeTitle}</span>` : ''}
            </div>
            ${customMode ? `
            <div class="qpl-order-btns">
                <button class="qpl-order-up"  title="위로"><i class="fa-solid fa-chevron-up"></i></button>
                <button class="qpl-order-down" title="아래로"><i class="fa-solid fa-chevron-down"></i></button>
            </div>` : `
            <button class="qpl-pin-btn${locked ? ' active' : ''}"
                    title="${locked ? '채팅방 고정 해제' : '현재 채팅방에 고정'}">
                <i class="fa-${locked ? 'solid' : 'regular'} fa-thumbtack"></i>
            </button>`}
        </div>
    `);

    // 순서편집 모드가 아닐 때만 페르소나 전환
    if (!customMode) {
        $row.find('.qpl-avatar-wrap, .qpl-info').on('click', async () => {
            closeMenu();
            await setUserAvatar(avatarId);
            updateButtonState();
        });

        $row.find('.qpl-pin-btn').on('click', async e => {
            e.stopPropagation();
            await toggleChatLock(avatarId);
            const nowLocked = getLockedPersona() === avatarId;
            const $btn = $(e.currentTarget);
            $btn.toggleClass('active', nowLocked)
                .attr('title', nowLocked ? '채팅방 고정 해제' : '현재 채팅방에 고정')
                .find('i').attr('class', `fa-${nowLocked ? 'solid' : 'regular'} fa-thumbtack`);
        });
    }

    // 순서편집 모드: ↑↓ 버튼
    if (customMode) {
        $row.find('.qpl-order-up').on('click', e => {
            e.stopPropagation();
            moveItem(avatarId, -1);
            rebuildList();
        });
        $row.find('.qpl-order-down').on('click', e => {
            e.stopPropagation();
            moveItem(avatarId, 1);
            rebuildList();
        });
    }

    return $row;
}

// ─── 즐겨찾기 별 주입 ─────────────────────────────────────────────────────────
function injectFavoriteStars() {
    $('.avatar-container[data-avatar-id]').each(function () {
        const $item    = $(this);
        const avatarId = $item.attr('data-avatar-id');
        if (!avatarId || $item.find('.qpl-fav-star').length) return;

        const fav   = isFavorite(avatarId);
        const $star = $(`
            <button class="qpl-fav-star${fav ? ' active' : ''}"
                    title="${fav ? '즐겨찾기 해제' : '즐겨찾기 추가'}">
                <i class="fa-${fav ? 'solid' : 'regular'} fa-star"></i>
            </button>
        `);

        $star.on('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            toggleFavorite(avatarId);
            const now = isFavorite(avatarId);
            $(this)
                .toggleClass('active', now)
                .attr('title', now ? '즐겨찾기 해제' : '즐겨찾기 추가')
                .find('i').attr('class', `fa-${now ? 'solid' : 'regular'} fa-star`);
        });

        const $title = $item.find('.ch_additional_info').first();
        const $name  = $item.find('.ch_name').first();
        if ($title.length)     $title.before($star);
        else if ($name.length) $name.after($star);
        else                   $item.append($star);
    });
}

function setupPanelObserver() {
    let timer = null;
    new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(injectFavoriteStars, 200);
    }).observe(document.body, { childList: true, subtree: true });
}

// ─── 초기화 ────────────────────────────────────────────────────────────────────
jQuery(async () => {
    try {
        getSettings();
        setupPanelObserver();
        eventSource.on(event_types.CHAT_CHANGED,     updateButtonState);
        eventSource.on(event_types.SETTINGS_UPDATED, updateButtonState);
        eventSource.on(event_types.APP_READY, () => { addQuickPersonaButton(); updateButtonState(); });
        addQuickPersonaButton();
        $(document.body).on('click.qpl', e => {
            if (isOpen && !e.target.closest('#qplMenu') && !e.target.closest('#qplBtn')) closeMenu();
        });
        updateButtonState();
        console.log(`[${MODULE_NAME}] ✅ 로드 완료`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] ❌ 초기화 오류:`, err);
    }
});
