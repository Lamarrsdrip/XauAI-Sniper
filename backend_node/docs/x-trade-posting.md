# X trade posting setup

Automatic trade posts are disabled by default and remain disabled until an
administrator confirms `enable_auto` through the Admin gateway.

In the X Developer Portal, create or select the XauCloud app, enable **User
authentication settings**, and use OAuth 2.0 Authorization Code with PKCE for
the X account that will publish. Request `tweet.read`, `tweet.write`, and
`users.read`; request `offline.access` only if the organisation also implements
and stores refresh-token rotation. Complete the consent flow as that publishing
account, then store the resulting user access token only in the production
secret manager as:

```
X_USER_ACCESS_TOKEN
```

`X_ACCOUNT_USERNAME` is optional and only supplies a non-secret diagnostic
label. Never put either value in source, logs, a prompt, or the client bundle.

The service publishes to `POST https://api.x.com/2/tweets` with the user token.
Every final close is keyed by `account_login:ticket`, claimed atomically, and
recorded with the returned X post id. Automatic worker attempts are globally
spaced by at least 15 seconds; 429 responses and transient failures are queued
with bounded exponential retry. Use `preview` then `prepare` then `execute` for
the first manual post. Do not enable automatic posting until that post is
visibly confirmed on the intended X account.
