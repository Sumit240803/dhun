// Tells the server which language the app is in.
//
// The app's language lives on the device. That was enough until the server
// started writing text of its own — a push notification is composed before the
// app is even open, so the server has to know which language to write it in.

import { useEffect, useRef } from 'react';

import { authApi } from '@/api/endpoints/auth';
import { useTranslation } from '@/i18n';
import { useIsRegistered } from '@/store/session';

export function useLocaleSync(): void {
  const { locale } = useTranslation();
  const isRegistered = useIsRegistered();
  const synced = useRef<string | null>(null);

  useEffect(() => {
    if (!isRegistered || synced.current === locale) return;
    synced.current = locale;
    // Fire and forget. Getting this wrong costs one notification in the other
    // language; a failure here must never be seen.
    void authApi.updateProfile({ locale: locale === 'hi' ? 'hi-IN' : 'en-IN' }).catch(() => {
      synced.current = null;
    });
  }, [locale, isRegistered]);
}
