import {RequestCard} from "../Requests/RequestCard";
import requestsData from "../../data/requests";
import { useState } from "react";

export const LeaveRequests = () => {
  const [requests, setRequests] = useState(
    requestsData.filter(r => r.type === "Leave")
  );

  const updateRequest = (id, status, reason) => {
    setRequests(prev =>
      prev.map(r =>
        r.id === id ? { ...r, status } : r
      )
    );

    console.log("UPDATE:", id, status, reason);
    // 🔗 Backend API call later
  };

  return (
    <>
      {requests.map(req => (
        <RequestCard
          key={req.id}
          request={req}
          onUpdate={updateRequest}
        />
      ))}
    </>
  );
}
