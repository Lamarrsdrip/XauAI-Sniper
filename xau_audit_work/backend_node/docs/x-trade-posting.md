# X trade posting setup

Automatic trade posts are disabled by default and remain disabled until an
administrator confirms `enable_auto` through the Admin gateway.

In the X Developer Portal, create or select the XauCloud app, enable **User
authentication settings**, choose **Web App, Automated App or Bot**, and use
OAuth 2.0 Authorization Code with PKCE. Its callback URL is:

```
https://xaucloud.io/api/admin/x-posting/oauth/callback
```

Request `tweet.read`, `tweet.write`, `users.read`, and `offline.access`. Store
only the app credentials in the production secret manager:

```
X_OAUTH_CLIENT_ID
X_OAUTH_CLIENT_SECRET
```

Then use **Admin → Comms → X Posting → Connect official X account**. The
server performs the authorization-code exchange, encrypts the renewable user
credentials at rest, and refreshes them; no user token is copied into a prompt,
source file, or browser. `X_USER_ACCESS_TOKEN` remains a legacy server-only
fallback only.

The service publishes to `POST https://api.x.com/2/tweets` with the user token.
Every final close is keyed by `account_login:ticket`, claimed atomically, and
recorded with the returned X post id. Automatic worker attempts are globally
spaced by at least 15 seconds; 429 responses and transient failures are queued
with bounded exponential retry. Use `preview` then `prepare` then `execute` for
the first manual post. Do not enable automatic posting until that post is
visibly confirmed on the intended X account.
