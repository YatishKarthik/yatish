// Where the backend lives. Locally it is the FastAPI server on port 8000. In the deployed build the backend serves the
// site itself, so NEXT_PUBLIC_API_URL is set to "" and every request goes to the same address (relative URLs).
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
