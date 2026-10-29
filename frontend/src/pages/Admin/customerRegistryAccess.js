const ACCESS_ENDPOINTS = [
  '/api/admin/customers/access',
  '/api/admin/deployment-guide/access',
];

export async function canManageCustomerRegistry(headers) {
  for (const endpoint of ACCESS_ENDPOINTS) {
    const response = await fetch(endpoint, { headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 404 && endpoint !== ACCESS_ENDPOINTS[ACCESS_ENDPOINTS.length - 1]) continue;
    return response.ok && Boolean(data.can_manage_customers ?? data.can_view_deployment_guide);
  }
  return false;
}
