import React, { useState, useEffect } from 'react';
import { X, Zap, Plus, Trash2, AlertCircle } from 'lucide-react';

// Đọc lỗi từ response JSON của server, fallback theo mã trạng thái
async function readApiError(res) {
  try {
    const data = await res.json();
    return data.error || `Lỗi máy chủ (${res.status})`;
  } catch {
    return `Lỗi máy chủ (${res.status})`;
  }
}

export default function AutoReplyModal({ accountId, onClose }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(accountId || '');
  const [rules, setRules] = useState([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [pendingKeywords, setPendingKeywords] = useState([]);
  const [responseTemplate, setResponseTemplate] = useState('');
  const [loading, setLoading] = useState(true);
  const [addingToRuleId, setAddingToRuleId] = useState(null);
  const [addingKeyword, setAddingKeyword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Nạp danh sách tài khoản để chọn tài khoản cấu hình auto-reply
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const res = await fetch('/api/accounts');
        if (!res.ok) { setErrorMsg(await readApiError(res)); return; }
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setAccounts(list);
        setSelectedAccountId(prev => {
          if (prev && list.some(a => String(a.id) === String(prev))) return prev;
          return list.length > 0 ? String(list[0].id) : '';
        });
      } catch {
        setErrorMsg('Không tải được danh sách tài khoản');
      }
    };
    loadAccounts();
  }, []);

  const loadRules = async (accId) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accId}/auto-replies`);
      if (!res.ok) { setErrorMsg(await readApiError(res)); setRules([]); return; }
      const data = await res.json();
      setRules(Array.isArray(data) ? data : []);
    } catch {
      setErrorMsg('Không tải được danh sách quy tắc');
      setRules([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (selectedAccountId) loadRules(selectedAccountId); }, [selectedAccountId]);

  const addPendingKeyword = () => {
    const parts = keywordInput.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return;
    setPendingKeywords(prev => {
      const next = [...prev];
      for (const k of parts) {
        if (!next.some(x => x.toLowerCase() === k.toLowerCase())) next.push(k);
      }
      return next;
    });
    setKeywordInput('');
  };

  const handleAddRule = async (e) => {
    e.preventDefault();
    if (pendingKeywords.length === 0 || !responseTemplate.trim()) return;

    const res = await fetch(`/api/accounts/${selectedAccountId}/auto-replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: pendingKeywords, response_template: responseTemplate })
    });
    if (!res.ok) { setErrorMsg(await readApiError(res)); return; }

    setErrorMsg('');
    setPendingKeywords([]);
    setResponseTemplate('');
    loadRules(selectedAccountId);
  };

  const handleToggleRule = async (id, currentStatus) => {
    const res = await fetch(`/api/auto-replies/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !currentStatus })
    });
    if (!res.ok) { setErrorMsg(await readApiError(res)); return; }
    setErrorMsg('');
    setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: !currentStatus ? 1 : 0 } : r));
  };

  const handleDeleteRule = async (id) => {
    const res = await fetch(`/api/auto-replies/${id}`, { method: 'DELETE' });
    if (!res.ok) { setErrorMsg(await readApiError(res)); return; }
    setErrorMsg('');
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const handleToggleKeyword = async (ruleId, kw, currentStatus) => {
    if (!kw.id) return;
    const res = await fetch(`/api/auto-replies/keywords/${kw.id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !currentStatus })
    });
    if (!res.ok) { setErrorMsg(await readApiError(res)); return; }
    setErrorMsg('');
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      return {
        ...r,
        keywords: (r.keywords || []).map(k => k.id === kw.id ? { ...k, is_active: !currentStatus ? 1 : 0 } : k)
      };
    }));
  };

  const handleDeleteKeyword = async (ruleId, kw) => {
    if (!kw.id) return;
    const res = await fetch(`/api/auto-replies/keywords/${kw.id}`, { method: 'DELETE' });
    if (!res.ok) { setErrorMsg(await readApiError(res)); return; }
    setErrorMsg('');
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      return { ...r, keywords: (r.keywords || []).filter(k => k.id !== kw.id) };
    }));
  };

  const handleAddKeywordToRule = async (ruleId) => {
    const trimmed = addingKeyword.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/auto-replies/${ruleId}/keywords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: trimmed })
    });
    if (!res.ok) { setErrorMsg(await readApiError(res)); setAddingKeyword(''); setAddingToRuleId(null); return; }
    const data = await res.json();
    setErrorMsg('');
    if (data.success && Array.isArray(data.keywords) && data.keywords.length > 0) {
      setRules(prev => prev.map(r => {
        if (r.id !== ruleId) return r;
        const existing = r.keywords || [];
        const merged = [...existing];
        for (const kw of data.keywords) {
          if (!merged.some(k => String(k.id) === String(kw.id))) merged.push(kw);
        }
        return { ...r, keywords: merged };
      }));
    }
    setAddingKeyword('');
    setAddingToRuleId(null);
  };

  const insertVariable = (varName) => {
    setResponseTemplate(prev => prev + varName);
  };

  const ruleKeywords = (rule) => {
    if (Array.isArray(rule.keywords) && rule.keywords.length > 0) return rule.keywords;
    return [{ id: null, keyword: rule.trigger_keyword, is_active: 1 }];
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-slate-300" />
            <h3 className="text-xs font-semibold text-slate-100 uppercase tracking-wider">Quản lý Phản hồi Tự động (Auto-Reply)</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Chọn tài khoản */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Tài khoản áp dụng:</label>
            <select
              value={selectedAccountId}
              onChange={(e) => { setSelectedAccountId(e.target.value); setErrorMsg(''); }}
              className="w-full bg-slate-950 text-slate-100 text-xs px-3 py-2 rounded-md border border-slate-800 focus:outline-none focus:border-slate-700"
            >
              {accounts.length === 0 && <option value="">Chưa có tài khoản nào</option>}
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.name || acc.id} ({acc.id})</option>
              ))}
            </select>
          </div>

          {/* Banner lỗi */}
          {errorMsg && (
            <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/30 rounded-md">
              <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-relaxed flex-1">{errorMsg}</p>
              <button onClick={() => setErrorMsg('')} className="text-red-400/70 hover:text-red-300 shrink-0">
                <X size={13} />
              </button>
            </div>
          )}

          {/* Form thêm quy tắc */}
          <form onSubmit={handleAddRule} className="p-3.5 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Thêm quy tắc mới</h4>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Cụm từ khóa kích hoạt (nhiều cụm cách nhau bằng dấu phẩy):</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="VD: giá, báo giá, giá bao nhiêu..."
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPendingKeyword(); } }}
                  className="flex-1 bg-slate-900 text-slate-100 text-xs px-3 py-1.5 rounded-md border border-slate-800 focus:outline-none focus:border-slate-700"
                />
                <button
                  type="button"
                  onClick={addPendingKeyword}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-md border border-slate-700/60 flex items-center gap-1"
                >
                  <Plus size={13} /> Thêm
                </button>
              </div>
              {pendingKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {pendingKeywords.map((k) => (
                    <span key={k} className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                      "{k}"
                      <button
                        type="button"
                        onClick={() => setPendingKeywords(prev => prev.filter(x => x !== k))}
                        className="text-amber-400/60 hover:text-amber-300"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-400">Nội dung mẫu phản hồi:</label>
                <button
                  type="button"
                  onClick={() => insertVariable('{ten_khach_hang}')}
                  className="text-[11px] text-blue-400 hover:underline font-medium"
                >
                  + Chèn {'{ten_khach_hang}'}
                </button>
              </div>
              <textarea
                rows={2}
                placeholder="VD: Dạ chào {ten_khach_hang}, shop xin báo giá chi tiết..."
                value={responseTemplate}
                onChange={(e) => setResponseTemplate(e.target.value)}
                className="w-full bg-slate-900 text-slate-100 text-xs p-2.5 rounded-md border border-slate-800 focus:outline-none focus:border-slate-700 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={!selectedAccountId || pendingKeywords.length === 0 || !responseTemplate.trim()}
              className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-medium text-xs rounded-md transition-colors border border-slate-700/60 flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> Thêm Quy Tắc
            </button>
          </form>

          {/* Danh sách quy tắc */}
          <div className="space-y-2.5">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Danh sách quy tắc ({rules.length})</h4>

            {!loading && rules.length === 0 && (
              <p className="text-xs text-slate-500">Chưa có quy tắc nào cho tài khoản này.</p>
            )}

            {rules.map((rule) => {
              const kws = ruleKeywords(rule);
              return (
                <div key={rule.id} className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {kws.map((kw) => (
                        <span key={kw.id ?? kw.keyword} className="inline-flex items-center gap-1">
                          <span className={`inline-flex items-center text-[11px] font-mono px-2 py-0.5 rounded border ${
                            kw.is_active
                              ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                              : 'text-slate-500 bg-slate-900 border-slate-800 line-through'
                          }`}>
                            "{kw.keyword}"
                          </span>
                          <span className={`text-[10px] font-medium ${kw.is_active ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {kw.is_active ? 'Bật' : 'Tắt'}
                          </span>
                          <button
                            onClick={() => handleToggleKeyword(rule.id, kw, kw.is_active)}
                            disabled={!kw.id}
                            title={kw.is_active ? 'Đang bật - bấm để tắt cụm này' : 'Đang tắt - bấm để bật cụm này'}
                            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                              kw.is_active ? 'bg-emerald-500' : 'bg-slate-700'
                            } ${!kw.id ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${
                              kw.is_active ? 'left-5' : 'left-0.5'
                            }`} />
                          </button>
                          {kw.id && kws.length > 1 && (
                            <button
                              onClick={() => handleDeleteKeyword(rule.id, kw)}
                              title="Xóa cụm từ này"
                              className="text-slate-600 hover:text-red-400 -ml-0.5"
                            >
                              <X size={11} />
                            </button>
                          )}
                        </span>
                      ))}
                      {addingToRuleId === rule.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="text"
                            autoFocus
                            placeholder="Cụm mới..."
                            value={addingKeyword}
                            onChange={(e) => setAddingKeyword(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddKeywordToRule(rule.id); } }}
                            className="w-24 bg-slate-900 text-slate-100 text-[11px] px-2 py-0.5 rounded border border-slate-700 focus:outline-none focus:border-slate-500"
                          />
                          <button
                            onClick={() => handleAddKeywordToRule(rule.id)}
                            className="text-[11px] px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700/60"
                          >
                            OK
                          </button>
                          <button
                            onClick={() => { setAddingToRuleId(null); setAddingKeyword(''); }}
                            className="text-slate-600 hover:text-slate-400"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setAddingToRuleId(rule.id)}
                          title="Thêm cụm từ khóa cho quy tắc này"
                          className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded border border-dashed border-slate-700"
                        >
                          <Plus size={10} /> Thêm cụm
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{rule.response_template}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggleRule(rule.id, rule.is_active)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                        rule.is_active
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}
                    >
                      {rule.is_active ? 'Đang bật' : 'Tắt'}
                    </button>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/40 text-right">
          <button onClick={onClose} className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-xs font-medium border border-slate-700/60">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
