/**
 * Stranger Mingle API
 * 
 * This is the root of the backend API service.
 * All API routes are under /api/*
 */

export default function Page() {
  return (
    <div style={{ 
      padding: '4rem 2rem', 
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: '600px',
      margin: '0 auto',
      lineHeight: '1.6'
    }}>
      <h1 style={{ color: '#1a1a1a', fontSize: '2.5rem', marginBottom: '1rem' }}>
        Stranger Mingle API
      </h1>
      <p style={{ color: '#666', fontSize: '1.2rem' }}>
        The backend service is running successfully.
      </p>
      <div style={{ 
        marginTop: '2rem', 
        padding: '1rem', 
        background: '#f5f5f5', 
        borderRadius: '8px',
        border: '1px solid #ddd'
      }}>
        <code style={{ fontSize: '0.9rem' }}>
          Status: Operational<br />
          Platform: Next.js API
        </code>
      </div>
    </div>
  );
}
