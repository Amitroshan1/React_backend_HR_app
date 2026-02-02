export const TeamSkeleton = () =>{
  return (
    <>
      {[1,2,3].map(i => (
        <div className="team-member skeleton" key={i}>
          <div className="member-left">
            <div className="member-avatar skeleton-box" />
            <div>
              <div className="skeleton-line short" />
              <div className="skeleton-line" />
            </div>
          </div>
          <div className="skeleton-line progress" />
        </div>
      ))}
    </>
  );
}
