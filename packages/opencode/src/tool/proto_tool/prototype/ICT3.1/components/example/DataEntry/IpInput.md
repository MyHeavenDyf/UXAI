# IpInput | IP地址输入框 示例

## Example: IPv4 Input

```json
{
  "state": {
    "ipv4Address": "10.80.52.212"
  },
  "rootId": "ipInputV4",
  "elements": [
    {
      "id": "ipInputV4",
      "component": "IpInput",
      "props": {
        "value": { "path": "/ipv4Address" },
        "type": "v4"
      }
    }
  ]
}
```

## Example: IPv6 Input

```json
{
  "state": {
    "ipv6Address": "10:80:52:211:0000:0000:0000:0000"
  },
  "rootId": "ipInputV6",
  "elements": [
    {
      "id": "ipInputV6",
      "component": "IpInput",
      "props": {
        "value": { "path": "/ipv6Address" },
        "type": "v6"
      }
    }
  ]
}
```

## Example: MAC Address Input

```json
{
  "state": {
    "macAddress": "3D-F2-C9-A6-B3-4F"
  },
  "rootId": "ipInputMac",
  "elements": [
    {
      "id": "ipInputMac",
      "component": "IpInput",
      "props": {
        "value": { "path": "/macAddress" },
        "type": "mac"
      }
    }
  ]
}
```
