import React from 'react';

type UserHomePanelProps = {
  userName: string;
  languageLabel: string;
  subtitle: string;
};

const UserHomePanel: React.FC<UserHomePanelProps> = ({ userName, languageLabel, subtitle }) => {
  return (
    <div className="bg-gradient-to-r from-cyan-500/15 to-blue-500/10 border border-cyan-400/20 rounded-2xl p-4">
      <div className="text-xs text-cyan-300/80 uppercase tracking-wide mb-1">{languageLabel}</div>
      <div className="text-white text-lg font-semibold">{userName}</div>
      <p className="text-white/60 text-sm mt-1">{subtitle}</p>
    </div>
  );
};

export default UserHomePanel;
