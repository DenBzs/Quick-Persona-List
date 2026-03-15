/**
 * Quick-Persona-List
 * ⚠️ 원본 Extension-QuickPersona와 동시 사용 불가
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
let isEditMode = false;

// ─── Settings ─────────────────────────────────────────────────────────────────
function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = { favorites: [], customOrder: null };
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    if (!Array.isArray(s.favorites)) s.favorites = [];
    if (s.customOrder !== null && !Array.isArray(s.customOrder)) s.customOrder = null;
    return s;
}

function saveSettings() { SillyTavern.getContext().saveSettingsDebounced(); }
function isFavorite(id) { return getSettings().favorites.includes(id); }

function toggleFavorite(avatarId) {
    const s = getSettings();
    const idx = s.favorites.indexOf(avatarId);
    if (idx >= 0) {
        s.favorites.splice(idx, 1);
        if (Array.isArray(s.customOrder)) s.customOrder = s.customOrder.filter(id => id !== avatarId);
    } else {
        s.favorites.push(avatarId);
        if (Array.isArray(s.customOrder)) s.customOrder.push(avatarId);
    }
    saveSettings();
}

// ─── 정렬 ─────────────────────────────────────────────────────────────────────
function getSortedFavorites(allAvatars) {
    const s = getSettings();
    const favSet = new Set(s.favorites);
    const favAvatars = allAvatars.filter(id => favSet.has(id));
    if (Array.isArray(s.customOrder)) {
        const order = s.customOrder;
        return [
            ...order.filter(id => favSet.has(id)),
            ...favAvatars.filter(id => !order.includes(id)),
        ];
    }
    // 기본: 이름순
    return favAvatars.sort((a, b) => {
        const na = (power_user.personas?.[a] || a).toLowerCase();
        const nb = (power_user.personas?.[b] || b).toLowerCase();
        return na.localeCompare(nb, 'ko');
    });
}

function saveCustomOrder(orderIds) {
    const s = getSettings();
    s.customOrder = [...orderIds];
    saveSettings();
}

// ─── 채팅 고정 ─────────────────────────────────────────────────────────────────
function getLockedPersona() {
    try { return SillyTavern.getContext().chatMetadata?.['persona'] ?? null; }
    catch { return null; }
}

async function toggleChatLock(avatarId) {
    try {
        const ctx = SillyTavern.getContext();
        const meta = ctx.chatMetadata;
        if (!meta) { toastr.warning('채팅이 열려있지 않습니다.'); return; }
        const isLocked = meta['persona'] === avatarId;
        if (isLocked) {
            delete meta['persona'];
            toastr.info('채팅방 페르소나 고정을 해제했습니다.');
        } else {
            meta['persona'] = avatarId;
            await setUserAvatar(avatarId);
            toastr.success(`"${power_user.personas?.[avatarId] || avatarId}"을(를) 이 채팅방에 고정했습니다.`);
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
    const $c = $('#leftSendForm').length ? $('#leftSendForm')
        : $('#send_form').length ? $('#send_form')
        : $('form#send_form, .sendForm, #form_sheld').first();
    if (!$c.length) { setTimeout(addQuickPersonaButton, 1000); return; }
    $c.append(`
        <div id="qplBtn" tabindex="0" title="페르소나 목록 열기">
            <img id="qplBtnImg" src="/img/ai4.png" alt="persona" />
        </div>
    `);
    $('#qplBtn').on('click', () => toggleMenu());
}

function updateButtonState() {
    setTimeout(() => {
        const name  = power_user.personas?.[user_avatar] || user_avatar;
        const title = power_user.persona_descriptions?.[user_avatar]?.title || '';
        const url   = getImageUrl(user_avatar);
        $('#qplBtnImg').attr('src', url).attr('title', title ? `${name} — ${title}` : name);
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
    isEditMode = false;

    const allAvatars = await getUserAvatars(false);
    const s = getSettings();
    const hasFavs = s.favorites.length > 0;
    const listIds = hasFavs ? getSortedFavorites(allAvatars) : allAvatars;

    const $menu = $(`
        <div id="qplMenu">
            <div class="qpl-header">
                <span class="qpl-header-title">
                    <i class="fa-solid fa-user"></i>
                    페르소나${!hasFavs ? ' (전체)' : ''}
                </span>
                ${hasFavs ? `<button class="qpl-edit-btn" title="순서 편집">
                    <i class="fa-solid fa-pen-to-square"></i> 순서 편집
                </button>` : ''}
            </div>
            <div class="qpl-list"></div>
            ${!hasFavs ? '<div class="qpl-hint"><i class="fa-regular fa-star"></i> 페르소나 패널에서 ⭐를 눌러 즐겨찾기를 추가하세요.</div>' : ''}
        </div>
    `);

    renderList($menu.find('.qpl-list'), listIds, false);

    $menu.find('.qpl-edit-btn').on('click', e => {
        e.stopPropagation();
        enterEditMode(allAvatars);
    });

    $menu.hide();
    $(document.body).append($menu);
    
    $menu.fadeIn(animation_duration);

    popper = Popper.createPopper(
        document.getElementById('qplBtn'),
        document.getElementById('qplMenu'),
        { placement: 'top-start', modifiers: [{ name: 'offset', options: { offset: [0, 6] } }] },
    );
    popper.update();
}

function closeMenu() {
    if (!isOpen) return;
    isOpen = false;
    isEditMode = false;
    
    $('#qplMenu').fadeOut(animation_duration, () => $('#qplMenu').remove());
    if (popper) { popper.destroy(); popper = null; }
}

// ─── 일반 목록 렌더 ────────────────────────────────────────────────────────────
function renderList($list, listIds, editMode) {
    $list.empty();
    listIds.forEach(id => $list.append(createRow(id, editMode)));
}

// ─── 순서편집 모드 진입 ────────────────────────────────────────────────────────
function enterEditMode(allAvatars) {
    isEditMode = true;
    const s = getSettings();
    const listIds = getSortedFavorites(allAvatars);

    const $header = $('#qplMenu .qpl-header');
    $header.html(`
        <span class="qpl-header-title">
            <i class="fa-solid fa-grip-lines"></i> 순서 편집
        </span>
        <button class="qpl-done-btn">
            <i class="fa-solid fa-check"></i> 편집 완료
        </button>
    `);

    const $list = $('#qplMenu .qpl-list');
    renderList($list, listIds, true);
    setupTouchDrag($list);

    $header.find('.qpl-done-btn').on('click', e => {
        e.stopPropagation();
        // 현재 DOM 순서에서 avatarId 수집 → 저장
        const newOrder = [];
        $list.find('.qpl-row[data-avatar]').each(function () {
            newOrder.push($(this).attr('data-avatar'));
        });
        saveCustomOrder(newOrder);
        exitEditMode(allAvatars);
    });

    if (popper) popper.update();
}

function exitEditMode(allAvatars) {
    isEditMode = false;
    const listIds = getSortedFavorites(allAvatars);

    const $header = $('#qplMenu .qpl-header');
    $header.html(`
        <span class="qpl-header-title">
            <i class="fa-solid fa-user"></i> 페르소나
        </span>
        <button class="qpl-edit-btn" title="순서 편집">
            <i class="fa-solid fa-pen-to-square"></i> 순서 편집
        </button>
    `);
    $header.find('.qpl-edit-btn').on('click', e => {
        e.stopPropagation();
        enterEditMode(allAvatars);
    });

    const $list = $('#qplMenu .qpl-list');
    renderList($list, listIds, false);

    if (popper) popper.update();
}

// ─── 터치/마우스 드래그 (Pointer Events API) ──────────────────────────────────
function setupTouchDrag($list) {
    const list = $list[0];
    let dragging    = null;
    let placeholder = null;
    let offsetY     = 0;
    let pendingY    = null;
    let rafId       = null;
    let pointerId   = null;

    // dragging은 body로 옮겨진 상태 → list 안에 없으므로 그냥 찾으면 됨
    function getRowAt(y) {
        for (const row of list.querySelectorAll('.qpl-row')) {
            const rect = row.getBoundingClientRect();
            if (y >= rect.top && y <= rect.bottom) return row;
        }
        return null;
    }

    function onPointerDown(e) {
        if (dragging) return; // 이미 드래그 중이면 무시
        const handle = e.target.closest('.qpl-drag-handle');
        if (!handle) return;
        const row = handle.closest('.qpl-row');
        if (!row) return;

        e.preventDefault();
        pointerId = e.pointerId;
        list.setPointerCapture(e.pointerId);

        const rect = row.getBoundingClientRect();
        offsetY = e.clientY - rect.top;

        // placeholder: 원래 자리 유지
        placeholder = document.createElement('div');
        placeholder.className = 'qpl-placeholder';
        placeholder.style.height = rect.height + 'px';
        row.parentNode.insertBefore(placeholder, row);

        // dragging: body에 fixed
        dragging = row;
        dragging.classList.add('qpl-dragging');
        dragging.style.width = rect.width + 'px';
        dragging.style.left  = rect.left  + 'px';
        dragging.style.top   = rect.top   + 'px';
        document.body.appendChild(dragging);

        pauseObserver();
    }

    function onPointerMove(e) {
        if (!dragging || e.pointerId !== pointerId) return;
        e.preventDefault();
        pendingY = e.clientY;
        const pendingX = e.clientX;

        if (rafId === null) {
            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (!dragging) return;

                // 위치 이동
                dragging.style.top = (pendingY - offsetY) + 'px';

                // 아래에 있는 행 찾기
                const target = getRowAt(pendingY);
                if (target && target !== placeholder && list.contains(target)) {
                    const rect   = target.getBoundingClientRect();
                    const middle = rect.top + rect.height / 2;
                    if (pendingY < middle) {
                        list.insertBefore(placeholder, target);
                    } else {
                        list.insertBefore(placeholder, target.nextSibling);
                    }
                }
            });
        }
    }

    function onPointerUp(e) {
        if (!dragging) return;
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }

        dragging.classList.remove('qpl-dragging');
        dragging.style.width = '';
        dragging.style.top   = '';
        dragging.style.left  = '';
        list.insertBefore(dragging, placeholder);
        placeholder.remove();

        placeholder = null;
        dragging    = null;
        pendingY    = null;
        pointerId   = null;

        resumeObserver();
        if (popper) popper.update();
    }

    list.addEventListener('pointerdown',   onPointerDown, { passive: false });
    list.addEventListener('pointermove',   onPointerMove, { passive: false });
    list.addEventListener('pointerup',     onPointerUp);
    list.addEventListener('pointercancel', onPointerUp);
}

// ─── 행 생성 ──────────────────────────────────────────────────────────────────
function createRow(avatarId, editMode = false) {
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
        <div class="qpl-row${isActive ? ' qpl-active' : ''}${editMode ? ' qpl-edit-mode' : ''}" data-avatar="${safeId}">
            ${editMode ? '<div class="qpl-drag-handle"><i class="fa-solid fa-grip-vertical"></i></div>' : ''}
            <div class="qpl-avatar-wrap">
                <img class="qpl-avatar${isDefault ? ' qpl-default' : ''}" src="${imgUrl}" alt="${safeName}" />
            </div>
            <div class="qpl-info">
                <span class="qpl-name">${safeName}</span>
                ${safeTitle ? `<span class="qpl-tag">${safeTitle}</span>` : ''}
            </div>
            ${!editMode ? `
            <button class="qpl-pin-btn${locked ? ' active' : ''}"
                    title="${locked ? '채팅방 고정 해제' : '현재 채팅방에 고정'}">
                <i class="fa-${locked ? 'solid' : 'regular'} fa-thumbtack"></i>
            </button>` : ''}
        </div>
    `);

    if (!editMode) {
        $row.find('.qpl-avatar-wrap, .qpl-info').on('click', async () => {
            closeMenu();
            await setUserAvatar(avatarId);
            updateButtonState();
        });
        $row.find('.qpl-pin-btn').on('click', async e => {
            e.stopPropagation();
            await toggleChatLock(avatarId);
            const nowLocked = getLockedPersona() === avatarId;
            const $b = $(e.currentTarget);
            $b.toggleClass('active', nowLocked)
              .attr('title', nowLocked ? '채팅방 고정 해제' : '현재 채팅방에 고정')
              .find('i').attr('class', `fa-${nowLocked ? 'solid' : 'regular'} fa-thumbtack`);
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
            <button class="qpl-fav-star${fav ? ' active' : ''}" title="${fav ? '즐겨찾기 해제' : '즐겨찾기 추가'}">
                <i class="fa-${fav ? 'solid' : 'regular'} fa-star"></i>
            </button>
        `);
        $star.on('click', function (e) {
            e.stopPropagation(); e.preventDefault();
            toggleFavorite(avatarId);
            const now = isFavorite(avatarId);
            $(this).toggleClass('active', now)
                   .attr('title', now ? '즐겨찾기 해제' : '즐겨찾기 추가')
                   .find('i').attr('class', `fa-${now ? 'solid' : 'regular'} fa-star`);
        });

        const $title = $item.find('.ch_additional_info').first();
        const $name  = $item.find('.ch_name').first();
        if ($title.length) $title.before($star);
        else if ($name.length) $name.after($star);
        else $item.append($star);
    });
}

let _observer = null;
let _observerPaused = false;

function pauseObserver()  { _observerPaused = true; }
function resumeObserver() { _observerPaused = false; }

function setupPanelObserver() {
    let timer = null;
    _observer = new MutationObserver(() => {
        if (_observerPaused) return;   // 드래그 중 무시
        clearTimeout(timer);
        timer = setTimeout(injectFavoriteStars, 200);
    });
    _observer.observe(document.body, { childList: true, subtree: true });
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
