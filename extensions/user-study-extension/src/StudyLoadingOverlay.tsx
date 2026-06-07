import React from 'react';

const StudyLoadingOverlay: React.FC<{ message?: string }> = ({
  message = 'Loading mammogram images...',
}) => {
  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-[#001a66]">
      <div className="flex flex-col items-center gap-5 px-6 text-center text-white">
        <div className="h-14 w-14 animate-spin rounded-full border-4 border-white/30 border-t-white" />
        <div className="space-y-2">
          <p className="text-lg font-semibold">{message}</p>
          <p className="text-sm text-white/80">This can take a few seconds.</p>
        </div>
      </div>
    </div>
  );
};

export default StudyLoadingOverlay;
