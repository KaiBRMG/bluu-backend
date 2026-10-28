# CA Shift Calendar

Create a new page CA Portal > Calendar.

This must work directly with the schedule in Admin > Shift Management. But where the current schedule has people in the row headers, make the new one specific for CA and display creators as the row headers. 

This page must become the parent entity of the shift calendar in the Dashboard, so include all associated features here. Use shared components where possible. Keep the dashboard calendar unchanged.

Admins must have access to admin tools to maintain the shift calendar. Ensure all changes sync with the main shift schedule.

# Session Log Out

Any change to the user's core identity or access privileges must immediately terminate all active sessions to prevent privilege escalation.

2FA

IP Address Change: The session's IP address changes abruptly (e.g., moving from the corporate office Wi-Fi to a public coffee shop network).

Impossible Travel (Geo-Velocity): API requests for the same session originate from two geographically distant locations in an impossibly short timeframe.

Browser/Device Fingerprint Change: The user-agent string or device fingerprint changes mid-session, which often indicates session hijacking (cookie theft).
