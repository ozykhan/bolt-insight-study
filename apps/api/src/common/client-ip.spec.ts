import { clientIp } from './client-ip.js';

describe('clientIp', () => {
  it('uses the socket address when no header is trusted', () => {
    expect(clientIp({ 'x-real-ip': '203.0.113.9' }, '198.51.100.4', undefined)).toBe('198.51.100.4');
  });

  it('uses the trusted header when the proxy set it, ignoring its case', () => {
    expect(clientIp({ 'x-real-ip': '203.0.113.9' }, '10.0.0.2', 'X-Real-IP')).toBe('203.0.113.9');
  });

  it('takes the first address when the header holds a list', () => {
    expect(clientIp({ 'x-real-ip': ' 203.0.113.9, 10.0.0.2' }, '10.0.0.2', 'x-real-ip')).toBe('203.0.113.9');
  });

  it('falls back to the socket address when the trusted header is missing', () => {
    expect(clientIp({}, '10.0.0.2', 'x-real-ip')).toBe('10.0.0.2');
  });

  it('groups IPv6 clients by their /64 network', () => {
    const one = clientIp({ 'x-real-ip': '2001:db8:1:2::1' }, '10.0.0.2', 'x-real-ip');
    const two = clientIp({ 'x-real-ip': '2001:db8:1:2:ffff::9' }, '10.0.0.2', 'x-real-ip');
    expect(one).toBe(two);
    expect(clientIp({ 'x-real-ip': '2001:db8:1:3::1' }, '10.0.0.2', 'x-real-ip')).not.toBe(one);
  });
});
