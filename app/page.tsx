export default function Home() {
  return (
    <main
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif',
        maxWidth: 560,
        margin: '80px auto',
        padding: '0 24px',
        lineHeight: 1.6,
        color: '#1a1a1a',
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Rose&rsquo;s Daily Brief</h1>
      <p style={{ color: '#6b6b6b', marginTop: 0 }}>
        A cron job sends one summarized news email each morning at 11:00 UTC.
      </p>
      <p>
        <a href="/api/preview?debug=1" style={{ color: '#1a56b8' }}>
          Preview today&rsquo;s brief
        </a>{' '}
        &mdash; renders the email without sending it.
      </p>
    </main>
  );
}
