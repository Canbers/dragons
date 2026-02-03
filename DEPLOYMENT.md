# Dragons Deployment Guide

## Render.com Deployment

### Quick Setup

1. **Connect GitHub to Render**
   - Go to [render.com](https://render.com) dashboard
   - New → Web Service
   - Connect your GitHub account
   - Select `Canbers/dragons` repo

2. **Import render.yaml** (automatic)
   - Render will detect `render.yaml` and use its config
   - Or manually configure with these settings:
     - Build Command: `npm install`
     - Start Command: `node server.js`
     - Plan: Free

3. **Set Secret Environment Variables** (in Render dashboard)
   These are marked `sync: false` in render.yaml for security:
   ```
   AUTH0_SECRET=<your-auth0-secret>
   MONGO_URL=<your-mongodb-connection-string>
   OPENAI_API_KEY=<your-openai-api-key>
   ```

4. **Custom Domain** (optional)
   - In Render dashboard → Settings → Custom Domains
   - Add `dragons.canby.ca`
   - Update DNS to point to Render

### Environment Variables (Full List)

| Variable | Value | Secret? |
|----------|-------|---------|
| NODE_ENV | production | No |
| API_BASE_URL | https://dragons.canby.ca | No |
| AUTH0_BASE_URL | https://dragons.canby.ca/ | No |
| AUTH0_CLIENT_ID | iB0eJ0fR8Epm998FGee1oOkOLnkRuS8G | No |
| AUTH0_ISSUER_BASE_URL | https://dev-p2sfrp7y1sd5qzn8.us.auth0.com | No |
| AUTH0_SECRET | (set in dashboard) | **Yes** |
| DRAGONS_PROJECT | proj_rGHHWz0pmWZLkMKMWDZvhJok | No |
| MONGO_URL | (set in dashboard) | **Yes** |
| OPENAI_API_KEY | (set in dashboard) | **Yes** |
| OPENAI_ORG_ID | org-0ovBa9zPgFJUMMsFWja7tUCN | No |
| GAME_MODEL | gpt-4o-mini | No |

### Free Tier Notes

- Server sleeps after 15 minutes of inactivity
- Wakes up on first request (~30-60 sec cold start)
- 750 free hours/month (plenty for hobby use)
- Auto-deploy on git push enabled

### Troubleshooting

**Server won't start:**
- Check Render logs for errors
- Verify all env vars are set
- Make sure MONGO_URL is accessible from Render's IPs

**Auth0 issues:**
- Verify AUTH0_BASE_URL matches your Render URL exactly
- Check Auth0 dashboard allowed callback URLs include your domain

**MongoDB connection fails:**
- MongoDB Atlas: Add `0.0.0.0/0` to IP whitelist (or Render's IPs)
- Railway Mongo: Should work as-is
