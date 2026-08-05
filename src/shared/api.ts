export interface HealthResponse {
  status: "ok";
  service: "northstar-crm";
  timestamp: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}
