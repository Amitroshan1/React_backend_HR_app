import requestsData from "../../data/requests";
import {RequestCard} from "../Requests/RequestCard";
import { useState } from "react";

export const ClaimRequests = () => {
  const [requests, setRequests] = useState(
    requestsData.filter(r => r.type === "Claim")
  );

  const updateRequest = (id, status, reason) => {
    setRequests(prev =>
      prev.map(r =>
        r.id === id ? { ...r, status } : r
      )
    );

    console.log("CLAIM:", id, status, reason);
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
