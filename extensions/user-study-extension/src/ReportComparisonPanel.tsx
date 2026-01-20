import React, { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

import { db } from '../../../platform/app/src/firebase';

type ReportItem = {
  aiGen: string;
  groundTruth: string;
  filepath: string;
};

const ReportComparisonPanel: React.FC = () => {
  const [reportItems, setReportItems] = useState<ReportItem[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [currentReportIndex, setCurrentReportIndex] = useState(0);
  const totalReports = reportItems.length;

  useEffect(() => {
    let cancelled = false;

    const loadReports = async () => {
      setReportLoading(true);
      setReportError('');

      try {
        const subcollectionRef = collection(db, 'mammogram-study', 'reports-data', 'reports');
        const subcollectionSnap = await getDocs(subcollectionRef);
        let items: ReportItem[] = subcollectionSnap.docs
          .map(docSnap => {
            const data = docSnap.data() || {};
            return {
              id: docSnap.id,
              aiGen: String(data['ai-gen'] ?? ''),
              groundTruth: String(data['ground-truth'] ?? ''),
              filepath: String(data.filepath ?? ''),
            };
          })
          .sort((a, b) => {
            const aNum = Number(a.id);
            const bNum = Number(b.id);
            if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
              return aNum - bNum;
            }
            return a.id.localeCompare(b.id);
          })
          .map(({ aiGen, groundTruth, filepath }) => ({ aiGen, groundTruth, filepath }));

        if (!items.length) {
          const reportsDocRef = doc(db, 'mammogram-study', 'reports-data');
          const reportsDoc = await getDoc(reportsDocRef);
          const data = reportsDoc.exists() ? reportsDoc.data() || {} : {};
          const reportsMap = data.reports && typeof data.reports === 'object' ? data.reports : {};
          items = Object.entries(reportsMap)
            .map(([key, value]) => {
              const reportValue = value && typeof value === 'object' ? value : {};
              return {
                id: String(key),
                aiGen: String((reportValue as any)['ai-gen'] ?? ''),
                groundTruth: String((reportValue as any)['ground-truth'] ?? ''),
                filepath: String((reportValue as any).filepath ?? ''),
              };
            })
            .sort((a, b) => {
              const aNum = Number(a.id);
              const bNum = Number(b.id);
              if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
                return aNum - bNum;
              }
              return a.id.localeCompare(b.id);
            })
            .map(({ aiGen, groundTruth, filepath }) => ({ aiGen, groundTruth, filepath }));
        }

        if (!cancelled) {
          if (!items.length) {
            setReportItems([]);
            setReportError('Report data is unavailable.');
            return;
          }
          setReportItems(items);
        }
      } catch (loadError) {
        console.error('ReportComparisonPanel: failed to load reports', loadError);
        if (!cancelled) {
          setReportItems([]);
          setReportError('Unable to load report data. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setReportLoading(false);
        }
      }
    };

    loadReports();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const delta = typeof detail.delta === 'number' ? detail.delta : 0;
      if (!delta || totalReports === 0) {
        return;
      }
      setCurrentReportIndex(prev =>
        Math.min(Math.max(prev + delta, 0), Math.max(totalReports - 1, 0))
      );
    };

    document.addEventListener('reportAdvance', handler);
    return () => document.removeEventListener('reportAdvance', handler);
  }, [totalReports]);
  const reportIndexLabel = totalReports > 0 ? `${currentReportIndex + 1}/${totalReports}` : '0/0';
  const currentAiReport = reportItems[currentReportIndex]?.aiGen || '';
  const currentGroundTruthReport = reportItems[currentReportIndex]?.groundTruth || '';
  const canGoPrev = !reportLoading && totalReports > 0 && currentReportIndex > 0;
  const canGoNext =
    !reportLoading && totalReports > 0 && currentReportIndex < totalReports - 1;

  useEffect(() => {
    if (!totalReports) {
      setCurrentReportIndex(0);
      return;
    }

    setCurrentReportIndex(prev => Math.min(prev, totalReports - 1));
  }, [totalReports]);

  useEffect(() => {
    document.dispatchEvent(
      new CustomEvent('reportIndexChanged', {
        detail: { index: currentReportIndex, total: totalReports },
      })
    );
  }, [currentReportIndex, totalReports]);

  return (
    <div className="shadow-primary-main/10 flex h-full flex-col rounded-2xl bg-[#050c24] p-4 text-white shadow-lg">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <p className="text-base font-semibold">Report Comparison</p>
          <p className="text-sm text-white/80">
            Review the AI-generated report against the ground truth report.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-white/70">{reportIndexLabel}</span>
          <button
            type="button"
            onClick={() => setCurrentReportIndex(prev => Math.max(0, prev - 1))}
            disabled={!canGoPrev}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              canGoPrev
                ? 'border border-white/30 text-white hover:border-white'
                : 'cursor-not-allowed border border-white/10 text-white/40'
            }`}
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setCurrentReportIndex(prev => Math.min(totalReports - 1, prev + 1))}
            disabled={!canGoNext}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              canGoNext
                ? 'bg-primary-light text-black hover:bg-white'
                : 'cursor-not-allowed bg-white/10 text-white/40'
            }`}
          >
            Next
          </button>
        </div>
      </div>

      {reportError && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0b1639] p-3 text-xs text-white/70">
          {reportError}
        </div>
      )}

      {!reportLoading && !reportError && totalReports === 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0b1639] p-3 text-xs text-white/70">
          No reports available yet.
        </div>
      )}

      {reportLoading && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0b1639] p-3 text-xs text-white/70">
          Loading report data...
        </div>
      )}

      {totalReports > 0 && !reportLoading && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
              AI-Generated Report
            </div>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/90">
              {currentAiReport || 'No AI-generated report available for this entry.'}
            </p>
          </div>
          <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
              Ground Truth Report
            </div>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/90">
              {currentGroundTruthReport || 'No ground truth report available for this entry.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportComparisonPanel;
