/**
 * Quick-Persona-List
 *
 * ⚠️ 원본 Extension-QuickPersona와 동시 사용 불가 — 비활성화 후 사용하세요.
 *
 * • 하단 바에 현재 페르소나 프사 버튼 표시
 * • 클릭 → 즐겨찾기된 페르소나 세로 목록
 *   - 각 행: [프사] [이름] [타이틀 태그] [📌 채팅방 고정]
 * • ST 페르소나 패널에 ⭐ 즐겨찾기 버튼 주입
 */

// ─── Imports: 원본 QuickPersona와 동일한 검증된 경로만 사용 ─────────────────────
import { animation_duration, eventSource, event_types, getThumbnailUrl } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { getUserAvatar, getUserAvatars, setUserAvatar, user_avatar } from '../../../personas.js';
import { Popper } from '../../../../lib.js';

// ─── 상수 ──────────────────────────────────────────────────────────────────────
const MODULE_NAME = 'Quick-Persona-List';
const supportsPersonaThumbnails = getThumbnailUrl('persona', 'test.png', true).includes('&t=');

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────
/** @type {Popper.Instance|null} */
let popper = null;
let isOpen = false;

// ─── Settings (즐겨찾기 목록) ─────────────────────────────────────────────────
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
    SillyTavern.getContext().saveSettingsDebounced();
}

// ─── 채팅 고정 ─────────────────────────────────────────────────────────────────
function getLockedPersona() {
    try {
        return SillyTavern.getContext().chatMetadata?.['persona'] ?? null;
    } catch {
        return null;
    }
}

async function toggleChatLock(avatarId) {
    try {
        const ctx  = SillyTavern.getContext();
        const meta = ctx.chatMetadata;
        if (!meta) {
            toastr.warning('채팅이 열려있지 않습니다.');
            return;
        }
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
        if (typeof ctx.saveMetadata === 'function') {
            await ctx.saveMetadata();
        }
        updateButtonState();
    } catch (err) {
        console.error('[Quick-Persona-List] 채팅 고정 오류:', err);
        toastr.error('채팅 고정에 실패했습니다.');
    }
}

// ─── 이미지 URL ────────────────────────────────────────────────────────────────
function getImageUrl(avatarId) {
    if (supportsPersonaThumbnails) {
        return getThumbnailUrl('persona', avatarId, true);
    }
    return `${getUserAvatar(avatarId)}?t=${Date.now()}`;
}

// ─── 하단 버튼 추가 ────────────────────────────────────────────────────────────
function addQuickPersonaButton() {
    if ($('#qplBtn').length) return;

    // #leftSendForm 이 없으면 대체 컨테이너 시도
    const $container = $('#leftSendForm').length
        ? $('#leftSendForm')
        : $('#send_form').length
            ? $('#send_form')
            : $('form#send_form, .sendForm, #form_sheld').first();

    if (!$container.length) {
        console.warn('[Quick-Persona-List] 버튼 컨테이너를 찾지 못했습니다. 1초 후 재시도...');
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
    console.log('[Quick-Persona-List] ✅ 버튼 추가 완료');
}

function updateButtonState() {
    setTimeout(() => {
        const name    = power_user.personas?.[user_avatar] || user_avatar;
        const title   = power_user.persona_descriptions?.[user_avatar]?.title || '';
        const imgUrl  = getImageUrl(user_avatar);
        const tooltip = title ? `${name} — ${title}` : name;
        $('#qplBtnImg').attr('src', imgUrl).attr('title', tooltip);
        const locked = getLockedPersona();
        $('#qplBtn').toggleClass('qpl-locked', !!locked && locked === user_avatar);
    }, 100);
}

// ─── 메뉴 열고 닫기 ────────────────────────────────────────────────────────────
async function toggleMenu() {
    if (isOpen) closeMenu();
    else await openMenu();
}

async function openMenu() {
    isOpen = true;

    const allAvatars = await getUserAvatars(false);
    const favIds     = getSettings().favorites;
    const listIds    = favIds.length > 0
        ? allAvatars.filter(id => favIds.includes(id))
        : allAvatars;

    const $menu = $(`
        <div id="qplMenu">
            <div class="qpl-header">
                <i class="fa-solid fa-user"></i>
                페르소나${favIds.length === 0 ? ' (전체)' : ''}
            </div>
            <div class="qpl-list"></div>
            ${favIds.length === 0
                ? '<div class="qpl-hint"><i class="fa-regular fa-star"></i> 페르소나 패널에서 ⭐를 눌러 즐겨찾기를 추가하세요.</div>'
                : ''}
        </div>
    `);

    listIds.forEach(id => $menu.find('.qpl-list').append(createRow(id)));

    $menu.hide();
    $(document.body).append($menu);
    $('#qplBtnCaret').removeClass('fa-caret-up').addClass('fa-caret-down');
    $menu.fadeIn(animation_duration);

    popper = Popper.createPopper(
        document.getElementById('qplBtn'),
        document.getElementById('qplMenu'),
        {
            placement: 'top-start',
            modifiers: [{ name: 'offset', options: { offset: [0, 6] } }],
        },
    );
    popper.update();
}

function closeMenu() {
    if (!isOpen) return;
    isOpen = false;
    $('#qplBtnCaret').removeClass('fa-caret-down').addClass('fa-caret-up');
    $('#qplMenu').fadeOut(animation_duration, () => $('#qplMenu').remove());
    if (popper) { popper.destroy(); popper = null; }
}

// ─── 페르소나 행 생성 ──────────────────────────────────────────────────────────
function createRow(avatarId) {
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
        <div class="qpl-row${isActive ? ' qpl-active' : ''}" data-avatar="${safeId}">
            <div class="qpl-avatar-wrap">
                <img class="qpl-avatar${isDefault ? ' qpl-default' : ''}"
                     src="${imgUrl}" alt="${safeName}" />
            </div>
            <div class="qpl-info">
                <span class="qpl-name">${safeName}</span>
                ${safeTitle ? `<span class="qpl-tag">${safeTitle}</span>` : ''}
            </div>
            <button class="qpl-pin-btn${locked ? ' active' : ''}"
                    title="${locked ? '채팅방 고정 해제' : '현재 채팅방에 고정'}">
                <i class="fa-${locked ? 'solid' : 'regular'} fa-thumbtack"></i>
            </button>
        </div>
    `);

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

    return $row;
}

// ─── ST 페르소나 패널에 ⭐ 버튼 주입 ─────────────────────────────────────────
// ST DOM 구조 (깡갤 테마 코드 기준):
//   .avatar-container[data-avatar-id]
//     .avatar > img
//     .ch_name            ← 이름
//     .ch_additional_info ← 타이틀 태그
//     .ch_description
//
// 목표: [이름] [⭐] [타이틀 태그] 순서로 인라인 배치
// → .ch_additional_info 바로 앞에 삽입
function injectFavoriteStars() {
    $('.avatar-container[data-avatar-id]').each(function () {
        const $item    = $(this);
        const avatarId = $item.attr('data-avatar-id');
        if (!avatarId) return;
        if ($item.find('.qpl-fav-star').length) return; // 이미 주입됨

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

        // [이름] 뒤, [타이틀] 앞에 삽입 → [이름][⭐][타이틀] 순서
        const $title = $item.find('.ch_additional_info').first();
        const $name  = $item.find('.ch_name').first();

        if ($title.length) {
            $title.before($star);
        } else if ($name.length) {
            $name.after($star);
        } else {
            $item.append($star);
        }
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

        // APP_READY 이후 버튼 추가 (DOM이 완전히 준비된 후)
        eventSource.on(event_types.APP_READY, () => {
            addQuickPersonaButton();
            updateButtonState();
        });

        // jQuery ready 시점에도 시도 (APP_READY보다 빠를 수 있음)
        addQuickPersonaButton();

        $(document.body).on('click.qpl', e => {
            if (isOpen && !e.target.closest('#qplMenu') && !e.target.closest('#qplBtn')) {
                closeMenu();
            }
        });

        updateButtonState();
        console.log(`[${MODULE_NAME}] ✅ 로드 완료`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] ❌ 초기화 오류:`, err);
    }
});
