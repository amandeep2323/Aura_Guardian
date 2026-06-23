import React from 'react';

type GuardianHomePanelProps = {
  userName: string;
  languageLabel: string;
  subtitle: string;
};

const GuardianHomePanel: React.FC<GuardianHomePanelProps> = ({ userName, languageLabel, subtitle }) => {
  return (
    <div className="bg-gradient-to-r from-amber-500/15 to-orange-500/10 border border-amber-400/20 rounded-2xl p-4">
      <div className="text-xs text-amber-300/80 uppercase tracking-wide mb-1">{languageLabel}</div>
      <div className="text-white text-lg font-semibold">{userName}</div>
      <p className="text-white/60 text-sm mt-1">{subtitle}</p>
    </div>
  );
};

export default GuardianHomePanel;
