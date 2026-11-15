// Where the backend lives. Locally it is the FastAPI server on port 8000. In the deployed container the backend
// serves the site itself, so the build sets NEXT_PUBLIC_API_URL="" and every request goes to the same address.
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export const apiUrl = (path: string): string => `${API}${path}`;
