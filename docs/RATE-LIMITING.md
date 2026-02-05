# Rate Limiting Configuration

This document explains how to configure rate limiting for the authentication endpoints using Cloudflare.

## Recommended Configuration

### Via Cloudflare Dashboard (Recommended)

1. Go to **Cloudflare Dashboard** > **Security** > **WAF** > **Rate limiting rules**

2. Create a new rule with the following settings:

   **Rule name:** Auth endpoint protection
   
   **Expression:**
   ```
   (http.request.uri.path contains "/api/auth/") or (http.request.uri.path eq "/callback")
   ```
   
   **Characteristics:** IP address
   
   **Rate:** 10 requests per 60 seconds
   
   **Action:** Block for 60 seconds

3. Click **Deploy**

### Alternative: Stricter Rules for Login

For additional protection against brute-force attacks on the login endpoint:

**Rule name:** Login endpoint protection

**Expression:**
```
(http.request.uri.path eq "/api/auth/login") and (http.request.method eq "POST")
```

**Characteristics:** IP address

**Rate:** 5 requests per 60 seconds

**Action:** Block for 300 seconds (5 minutes)

## Why These Settings?

1. **10 requests per minute for general auth endpoints** - Allows legitimate users to:
   - Make a few login attempts if they mistype their password
   - Request password resets
   - Complete email verification
   
2. **Stricter limits on login** - The login endpoint is the primary target for brute-force attacks. 5 attempts per minute is generous for legitimate users but stops automated attacks.

3. **IP-based blocking** - Simple and effective for most use cases. Note that this may block multiple users behind the same NAT/corporate network.

## Monitoring

After enabling rate limiting:

1. Monitor the **Security Analytics** dashboard for blocked requests
2. Adjust thresholds if you see legitimate traffic being blocked
3. Consider adding additional rules for specific patterns of abuse

## Advanced: Per-User Rate Limiting

For more sophisticated rate limiting based on user identity (not just IP), consider implementing application-level rate limiting using:

- **Cloudflare Durable Objects** - For distributed state
- **Cloudflare KV** - For simple counters with eventual consistency

This is typically only needed for applications with high traffic or specific compliance requirements.
