import requestsData from "../../data/requests";
import {RequestCard} from "../Requests/RequestCard";
import { useState } from "react";

export const WFHRequests =() => {
  const [requests, setRequests] = useState(
    requestsData.filter(r => r.type === "WFH")
  );

  const updateRequest = (id, status, reason) => {
    setRequests(prev =>
      prev.map(r =>
        r.id === id ? { ...r, status } : r
      )
    );

    console.log("WFH:", id, status, reason);
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
