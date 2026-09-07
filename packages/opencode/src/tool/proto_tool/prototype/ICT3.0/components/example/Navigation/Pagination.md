# Pagination | 分页

### Example: Pagination basic

```json
{
  "id": "paginationBasic",
  "component": "Pagination",
  "props": {
    "current": 1,
    "total": 120
  }
}
```

### Example: Pagination with data binding

```json
{
  "state": { "currentPage": 1, "totalCount": 246 },
  "rootId": "userPagination",
  "elements": [
    {
      "id": "userPagination",
      "component": "Pagination",
      "props": {
        "current": { "path": "/currentPage" },
        "total": { "path": "/totalCount" },
        "showTotal": true,
        "className": "mt-4"
      }
    }
  ]
}
```
