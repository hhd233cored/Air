export function MaintenancePage() {
  return (
    <main className="maintenance-page">
      <div className="maintenance-page__glow maintenance-page__glow--one" aria-hidden="true" />
      <div className="maintenance-page__glow maintenance-page__glow--two" aria-hidden="true" />

      <section className="maintenance-card" aria-labelledby="maintenance-title">
        <div className="maintenance-card__mark" aria-hidden="true">✦</div>
        <p className="maintenance-card__eyebrow">YOUR / SPACE</p>
        <h1 id="maintenance-title">网站维护中</h1>
        <p className="maintenance-card__english">A small space is being refreshed.</p>
        <p className="maintenance-card__message">
          网站正在进行维护和更新，新的内容很快就会回来。
          <br />
          感谢你的耐心等待。
        </p>
        <div className="maintenance-card__status">
          <span className="maintenance-card__status-dot" aria-hidden="true" />
          <span>暂时离线</span>
        </div>
      </section>
    </main>
  );
}
