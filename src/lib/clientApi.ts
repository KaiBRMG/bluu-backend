import { getAuth } from 'firebase/auth';

export async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('Not authenticated');
  const token = await user.getIdToken();
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}
