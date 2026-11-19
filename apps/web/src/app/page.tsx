import { getMessages } from '@/i18n';

export default function HomePage() {
  const t = getMessages();
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-bold">{t.home.heading}</h1>
      <p className="mt-2 text-lg">{t.app.tagline}</p>
      <p className="mt-6 rounded-md border-2 border-current p-4 text-base" role="status">
        {t.home.status}
      </p>
    </main>
  );
}
