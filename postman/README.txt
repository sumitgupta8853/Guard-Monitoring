Guard Monitor Postman
1 Import collection+environment
2 Select env Guard Monitor - Local
3 npm start then Auth>Admin Login (saves adminToken) > Create Site (saves siteId) > Create Guard (saves guardId) > Guard Login (saves guardToken)
4 photo rows: set Type=File, Select Files, pick jpg/png
5 Socket.IO: auth:{token} admin gets alert/guard:update/attendance:start/attendance:end guard gets warning
