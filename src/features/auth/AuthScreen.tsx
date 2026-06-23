import React, { useEffect, useMemo, useState } from 'react';
import { createUserWithEmailAndPassword, getRedirectResult, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { get, ref, set } from 'firebase/database';
import { auth, db, googleProvider } from '../../config/firebase';
import { AppLanguage, LANGUAGE_LABELS, translateText } from '../../config/i18n';
import { AppRole } from './types';

type AuthScreenProps = {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
};

const AuthScreen: React.FC<AuthScreenProps> = ({ language, onLanguageChange }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AppRole>('user');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const tr = useMemo(() => (text: string) => translateText(language, text), [language]);

  const persistRoleHint = (nextRole: AppRole) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('auraguard_role_hint', nextRole);
  };

  const ensureRole = async (uid: string, fallbackRole: AppRole) => {
    const roleRef = ref(db, `profiles/${uid}/role`);
    const snapshot = await get(roleRef);
    if (!snapshot.exists()) {
      await set(roleRef, fallbackRole);
    }
  };

  const isMobileWrapper = (): boolean => {
    if (typeof window === 'undefined') return false;

    const win = window as unknown as { Capacitor?: unknown; cordova?: unknown };
    const hasBridge = Boolean(win.Capacitor) || Boolean(win.cordova);
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase();
    const isWebView = ua.includes(' wv') || ua.includes('android');

    return hasBridge || isWebView;
  };

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const result = await getRedirectResult(auth);
        if (!result || disposed) return;

        await ensureRole(result.user.uid, role);
      } catch (authError) {
        if (disposed) return;
        const message = authError instanceof Error ? authError.message : 'Google redirect sign-in failed';
        setError(message);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [role]);

  const handleEmailAuth = async () => {
    if (!email.trim() || !password.trim()) {
      setError(tr('Please enter email and password'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (mode === 'signup') {
        persistRoleHint(role);
        const credentials = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await set(ref(db, `profiles/${credentials.user.uid}`), {
          role,
          email: credentials.user.email,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      } else {
        const credentials = await signInWithEmailAndPassword(auth, email.trim(), password);
        await ensureRole(credentials.user.uid, role);
      }
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : 'Authentication failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError('');

    try {
      persistRoleHint(role);
      if (isMobileWrapper()) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      const credentials = await signInWithPopup(auth, googleProvider);
      await ensureRole(credentials.user.uid, role);
    } catch (authError) {
      const rawMessage = authError instanceof Error ? authError.message : 'Google sign-in failed';
      const lower = rawMessage.toLowerCase();

      const message = lower.includes('auth/unauthorized-domain')
        ? 'Google login blocked: add localhost to Firebase Auth Authorized domains.'
        : rawMessage;
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-indigo-950 to-gray-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-5">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Aura Guardian</h1>
          <p className="text-white/60 mt-1">{tr('Secure access for users and guardians')}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/5 p-1">
          <button
            onClick={() => setMode('login')}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-indigo-500/30 text-indigo-200' : 'text-white/60'}`}
          >
            {LANGUAGE_LABELS[language].login}
          </button>
          <button
            onClick={() => setMode('signup')}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${mode === 'signup' ? 'bg-indigo-500/30 text-indigo-200' : 'text-white/60'}`}
          >
            {LANGUAGE_LABELS[language].signUp}
          </button>
        </div>

        <div className="space-y-3">
          <label className="block text-sm text-white/70">{tr('Role')}</label>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as AppRole)}
            className="w-full rounded-xl bg-gray-900/70 border border-white/15 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-400"
          >
            <option value="user" className="bg-gray-900">{LANGUAGE_LABELS[language].user}</option>
            <option value="guardian" className="bg-gray-900">{LANGUAGE_LABELS[language].guardian}</option>
          </select>

          <label className="block text-sm text-white/70">{tr('Email')}</label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl bg-gray-900/70 border border-white/15 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-400"
            placeholder="name@example.com"
          />

          <label className="block text-sm text-white/70">{tr('Password')}</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl bg-gray-900/70 border border-white/15 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-400"
            placeholder="********"
          />
        </div>

        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</div>}

        <div className="space-y-2">
          <button
            onClick={handleEmailAuth}
            disabled={loading}
            className="w-full rounded-xl bg-indigo-500 py-2.5 text-sm font-semibold hover:bg-indigo-400 disabled:opacity-60"
          >
            {loading ? tr('Please wait...') : (mode === 'signup' ? LANGUAGE_LABELS[language].signUp : LANGUAGE_LABELS[language].login)}
          </button>
          <button
            onClick={handleGoogleAuth}
            disabled={loading}
            className="w-full rounded-xl bg-white/10 py-2.5 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
          >
            {tr('Continue with Google')}
          </button>
        </div>

        <div className="pt-1">
          <label className="block text-xs text-white/60 mb-1">{tr('App Language')}</label>
          <select
            value={language}
            onChange={(event) => onLanguageChange(event.target.value as AppLanguage)}
            className="w-full rounded-lg bg-gray-900/70 border border-white/10 px-2.5 py-2 text-xs text-white"
          >
            <option value="English" className="bg-gray-900">English</option>
            <option value="Hindi" className="bg-gray-900">Hindi</option>
            <option value="Tamil" className="bg-gray-900">Tamil</option>
            <option value="Telugu" className="bg-gray-900">Telugu</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
