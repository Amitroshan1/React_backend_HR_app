import "./StatsCards.css";

export const StatsCards = ({ onSelect }) => {
  const cards = [
    {
      key: "claims",
      title: "Claim Requests",
      count: 8,
      subtitle: "Pending approvals",
      color: "blue",
    },
    {
      key: "leave",
      title: "Leave Requests",
      count: 5,
      subtitle: "Awaiting response",
      color: "orange",
    },
    {
      key: "wfh",
      title: "Work From Home Requests",
      count: 4,
      subtitle: "This week",
      color: "green",
    },
    {
      key: "resignation",
      title: "Resignation Requests",
      count: 1,
      subtitle: "Under review",
      color: "red",
    },
  ];

  return (
    <div className="stats-grid">
      {cards.map((card) => (
        <div
          key={card.key}
          className={`stat-card ${card.color}`}
          onClick={() => onSelect(card.key)}
        >
          <span className="accent-bar" />
          <div className="stat-content">
            <p className="title">{card.title}</p>
            <h2 className="count">{card.count}</h2>
            <span className="subtitle">{card.subtitle}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
