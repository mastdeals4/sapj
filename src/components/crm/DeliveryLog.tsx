import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import {
  Mail, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight,
  AlertTriangle, Paperclip, RefreshCw
} from 'lucide-react';

interface Campaign {
  id: string;
  subject: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  status: 'in_progress' | 'completed' | 'partial' | 'failed';
  has_attachments: boolean;
  started_at: string;
  completed_at: string | null;
  created_by: string;
  user_profiles?: { full_name: string | null };
}

interface Recipient {
  id: string;
  company_name: string;
  email: string;
  status: 'pending' | 'sent' | 'failed';
  error_message: string | null;
  sent_at: string | null;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export function DeliveryLog() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<Record<string, Recipient[]>>({});
  const [recipientsLoading, setRecipientsLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'partial' | 'failed'>('all');

  useEffect(() => {
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('bulk_email_campaigns')
      .select('*, user_profiles(full_name)')
      .order('started_at', { ascending: false })
      .limit(100);
    setCampaigns(data || []);
    setLoading(false);
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (recipients[id]) return;

    setRecipientsLoading(id);
    const { data } = await supabase
      .from('bulk_email_recipients')
      .select('id, company_name, email, status, error_message, sent_at')
      .eq('campaign_id', id)
      .order('status', { ascending: true }); // failed first
    setRecipients(prev => ({ ...prev, [id]: data || [] }));
    setRecipientsLoading(null);
  };

  const filteredCampaigns = campaigns.filter(c => {
    if (filter === 'all') return true;
    if (filter === 'partial') return c.status === 'partial';
    if (filter === 'failed') return c.status === 'failed' || c.failed_count > 0;
    return true;
  });

  const statusBadge = (status: Campaign['status'], failed: number) => {
    if (status === 'completed') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <CheckCircle className="w-3 h-3" /> All sent
      </span>
    );
    if (status === 'in_progress') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> Sending…
      </span>
    );
    if (status === 'failed') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <XCircle className="w-3 h-3" /> All failed
      </span>
    );
    // partial
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        <AlertTriangle className="w-3 h-3" /> {failed} failed
      </span>
    );
  };

  const recipientStatusIcon = (status: Recipient['status']) => {
    if (status === 'sent') return <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />;
    if (status === 'failed') return <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />;
    return <Clock className="w-4 h-4 text-gray-300 flex-shrink-0" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Email Delivery Log</h2>
          <p className="text-sm text-gray-500 mt-0.5">Full history of all bulk email campaigns and per-recipient outcomes</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['all', 'partial', 'failed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 transition ${filter === f ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {f === 'all' ? 'All' : f === 'partial' ? 'Partial' : 'Failed'}
              </button>
            ))}
          </div>
          <button
            onClick={loadCampaigns}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2" />
          Loading campaigns…
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Mail className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">No campaigns found</p>
          {filter !== 'all' && <p className="text-xs mt-1">Try switching to "All"</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredCampaigns.map(c => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              {/* Campaign row */}
              <button
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition text-left"
                onClick={() => toggleExpand(c.id)}
              >
                <div className="flex-shrink-0 text-gray-400">
                  {expandedId === c.id
                    ? <ChevronDown className="w-4 h-4" />
                    : <ChevronRight className="w-4 h-4" />
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 truncate">{c.subject}</span>
                    {c.has_attachments && (
                      <span className="flex items-center gap-0.5 text-xs text-gray-400">
                        <Paperclip className="w-3 h-3" /> attachment
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                    <span>{formatDateTime(c.started_at)}</span>
                    {c.user_profiles?.full_name && <span>by {c.user_profiles.full_name}</span>}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-center hidden sm:block">
                    <div className="text-sm font-semibold text-gray-900">{c.total_recipients}</div>
                    <div className="text-xs text-gray-400">total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-semibold text-green-600">{c.sent_count}</div>
                    <div className="text-xs text-gray-400">sent</div>
                  </div>
                  {c.failed_count > 0 && (
                    <div className="text-center">
                      <div className="text-sm font-semibold text-red-600">{c.failed_count}</div>
                      <div className="text-xs text-gray-400">failed</div>
                    </div>
                  )}
                  {statusBadge(c.status, c.failed_count)}
                </div>
              </button>

              {/* Recipients list */}
              {expandedId === c.id && (
                <div className="border-t border-gray-100">
                  {recipientsLoading === c.id ? (
                    <div className="flex items-center justify-center py-6 text-gray-400 text-sm">
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2" />
                      Loading recipients…
                    </div>
                  ) : (
                    <>
                      {/* Failed recipients at top, highlighted */}
                      {(recipients[c.id] || []).filter(r => r.status === 'failed').length > 0 && (
                        <div className="bg-red-50 border-b border-red-100 px-5 py-3">
                          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">
                            Failed — action needed
                          </p>
                          <div className="space-y-2">
                            {(recipients[c.id] || []).filter(r => r.status === 'failed').map(r => (
                              <div key={r.id} className="flex items-start gap-3 bg-white rounded-lg px-3 py-2.5 border border-red-200">
                                <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-800">{r.company_name}</p>
                                  <p className="text-xs text-gray-500">{r.email}</p>
                                  {r.error_message && (
                                    <p className="text-xs text-red-600 mt-0.5 font-mono bg-red-50 px-1.5 py-0.5 rounded">
                                      {r.error_message}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* All recipients table */}
                      <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                        {(recipients[c.id] || []).map(r => (
                          <div key={r.id} className={`flex items-center gap-3 px-5 py-2.5 ${r.status === 'failed' ? 'bg-red-50/50' : ''}`}>
                            {recipientStatusIcon(r.status)}
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-gray-800 font-medium">{r.company_name}</span>
                              <span className="text-xs text-gray-400 ml-2">{r.email}</span>
                            </div>
                            <div className="text-xs text-gray-400 flex-shrink-0">
                              {r.sent_at ? formatDateTime(r.sent_at) : r.status === 'pending' ? 'Pending' : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
