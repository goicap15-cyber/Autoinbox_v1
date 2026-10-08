// AutoChatbot - DOM realtime observer message-id/dedup logic.
//
// Mirrors (and must be kept in sync with) makeDomMessageId(),
// createBubbleFamilyTracker() and the lastObservedMessages Map decision in
// content.js's forwarding paths.
// content.js can't be require()'d directly (top-level DOM/service-worker
// side effects), so this exists to make the id/dedup logic testable in
// isolation - same duplication pattern as historyRowSupport.js /
// historySyncRoundBudget.js.
//
// Spec: specs/045-ghost-duplicate-message-investigation/spec.md

(function () {
  // is_outgoing/sender_name/effective_label deliberately excluded from the
  // hash: all three are derived from the message row's aria-label, which can
  // still be hydrating on a MutationObserver's first pass, so a re-scan of
  // the SAME message that read a different label produced a DIFFERENT id -
  // landing as a ghost duplicate row with a flipped direction (spec 045).
  function makeDomMessageId(thread_id, parsed) {
    if (parsed.native_id) {
      const nativeId = String(parsed.native_id);
      const bubbleIndex = Number(parsed.bubble_idx) || 0;
      return bubbleIndex > 0 ? `${nativeId}__bubble_${bubbleIndex}` : nativeId;
    }
    let textHash = 0;
    const strToHash = `${thread_id}|${parsed.content}`;
    for (let i = 0; i < strToHash.length; i++) {
      textHash = Math.imul(31, textHash) + strToHash.charCodeAt(i) | 0;
    }
    const occurrence = parsed.dom_occurrence_id ? `_occ_${parsed.dom_occurrence_id}` : '';
    return `dom_${thread_id}_hash_${Math.abs(textHash)}_${parsed.bubble_idx}${occurrence}`;
  }

  // Returns true when this reading should be SKIPPED (already forwarded with
  // the same id AND same direction). A same-id reading that now disagrees on
  // direction is NOT skipped - it must still reach the server (with the same
  // fbMessageId) so the existing reconcile/hysteresis path (spec 019) can
  // settle it, instead of a duplicate row or a silently-dropped correction.
  function shouldSkipObservation(lastObservedMessages, fbMessageId, isOutgoing) {
    return lastObservedMessages.get(fbMessageId) === isOutgoing;
  }

  // bubble_idx là chỉ số VỊ TRÍ trong lần quét, không phải định danh bền vững:
  // React hydrate lại article bằng lá dir="auto tạm thời, observer bắt node lá
  // nhỏ hơn article, hay đợt re-read muộn hơn đều làm CÙNG MỘT bong bóng vật
  // lý đổi chỉ số (mid.x <-> mid.x__bubble_1) giữa các lần quét. Hai id khác
  // nhau khiến guard theo id và UNIQUE(fb_message_id) của máy chủ cùng mù ->
  // dòng tin ma nhân đôi (hội thoại "Yến", 08-10-2026).
  //
  // Định danh bền vững thay thế: family (mid gốc) + chữ ký quan sát
  // (hướng|media|nội dung) + slot = thứ tự xuất hiện của chữ ký đó trong đợt
  // quét. Slot bất biến với drift vị trí vì các like/tin giống nhau LIÊN TIẾP
  // luôn nối đuôi nhau (slot mới chỉ xuất hiện khi batch có THÊM bản sao), còn
  // re-scan của tin cũ luôn chiếm slot 0..k-1 đã ghi.
  //
  // resolveBatch chỉ ĐỌC (verdict), markSeen phải được gọi đúng chỗ path gọi
  // lastObservedMessages.set - nếu mark theo batch thì tin outgoing media bị
  // các path bỏ qua sẽ bị khoá luôn và spinner pending không bao giờ tắt.
  function createBubbleFamilyTracker() {
    const seen = new Map(); // "familyId\u0000sig\u0000slot" -> true
    const MAX_SEEN = 20000;
    function markSeen(key) {
      if (!key || seen.has(key)) return;
      seen.set(key, true);
      if (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
    }
    // items: [{ nativeId, proposedId, sig }]. Trả về mảng verdict cùng thứ tự:
    // { id, key, duplicate }. Item không phải family mid.* (dom_ hash, id rỗng)
    // đi qua nguyên trạng với key null.
    function resolveBatch(items) {
      const results = items.map((item) => ({
        id: String(item?.proposedId ?? ''),
        key: null,
        duplicate: false
      }));
      const byFamily = new Map();
      items.forEach((item, index) => {
        const nativeId = String(item?.nativeId || '');
        if (!/^mid\./.test(nativeId)) return;
        const familyId = nativeId.replace(/__bubble_\d+$/, '');
        if (!byFamily.has(familyId)) byFamily.set(familyId, []);
        byFamily.get(familyId).push({ index, sig: String(item?.sig ?? '') });
      });
      byFamily.forEach((observations, familyId) => {
        const slots = new Map(); // sig -> slot kế tiếp
        for (const obs of observations) {
          const slot = slots.get(obs.sig) || 0;
          slots.set(obs.sig, slot + 1);
          const key = `${familyId}\u0000${obs.sig}\u0000${slot}`;
          results[obs.index].key = key;
          results[obs.index].duplicate = seen.has(key);
        }
      });
      return results;
    }
    return { resolveBatch, markSeen };
  }

  globalThis.FbCrmDomMessageDedup = { makeDomMessageId, shouldSkipObservation, createBubbleFamilyTracker };
})();
