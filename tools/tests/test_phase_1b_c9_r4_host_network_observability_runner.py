import json
import unittest

from tools.phase_1b_c9_r4_host_network_observability_runner import (
    DEFAULT_APPROVAL_RECORD,
    DEFAULT_CONTRACT,
    EXPECTED_RECORD_SHA,
    _summarize_ifconfig,
    _summarize_netstat,
    _summarize_route_get,
    preflight,
)


class Phase1BC9R4HostNetworkObservabilityRunnerTests(unittest.TestCase):
    def test_c9_r4_preflight_passes_without_execution(self):
        result = preflight(DEFAULT_CONTRACT, DEFAULT_APPROVAL_RECORD)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["target_instance"], "pc9r2")
        self.assertEqual(result["target_guest_ipv4"], "192.168.5.15")
        self.assertFalse(result["host_network_observability_executed"])
        self.assertFalse(result["pfctl_execution_allowed"])
        self.assertFalse(result["host_firewall_changes_allowed"])
        self.assertFalse(result["packet_capture_allowed"])
        self.assertFalse(result["guest_traffic_generation_allowed"])

    def test_c9_r4_approval_record_is_exact_and_synthetic_only(self):
        record = json.loads(DEFAULT_APPROVAL_RECORD.read_text(encoding="utf-8"))
        self.assertEqual(record["record_sha256"], EXPECTED_RECORD_SHA)
        self.assertTrue(record["synthetic_only"])
        self.assertTrue(record["host_network_observability_execution_allowed"])
        self.assertFalse(record["pfctl_execution_allowed"])
        self.assertFalse(record["packet_capture_allowed"])
        self.assertFalse(record["guest_traffic_generation_allowed"])
        self.assertFalse(record["host_firewall_changes_allowed"])
        self.assertFalse(record["real_credentials_allowed"])
        self.assertFalse(record["production_profiles_allowed"])

    def test_sanitizers_drop_raw_ips_except_target_route(self):
        ifconfig_summary = _summarize_ifconfig(
            "lo0: flags=8049<UP,LOOPBACK,RUNNING> mtu 16384\n"
            "    inet 127.0.0.1 netmask 0xff000000\n"
            "en0: flags=8863<UP,BROADCAST,RUNNING> mtu 1500\n"
            "    inet 8.8.8.8 netmask 0xffffff00 broadcast 8.8.8.255\n"
            "    status: active\n"
        )
        self.assertFalse(ifconfig_summary["raw_output_persisted"])
        self.assertEqual(ifconfig_summary["interfaces"][0]["ipv4_scopes"], ["loopback"])
        self.assertEqual(ifconfig_summary["interfaces"][1]["ipv4_scopes"], ["public"])

        netstat_summary = _summarize_netstat(
            "Destination        Gateway            Flags               Netif Expire\n"
            "default            10.0.0.1           UGScg                 en0\n"
            "192.168.5          link#22            UCS              bridge100      !\n"
            "192.168.5.15       1:2:3:4:5:6        UHLWIi           bridge100   1191\n"
        )
        self.assertFalse(netstat_summary["raw_output_persisted"])
        self.assertEqual(netstat_summary["default_routes_count"], 1)
        self.assertNotIn("Netif", netstat_summary["route_interfaces"])
        self.assertIn("bridge100", netstat_summary["route_interfaces"])
        self.assertEqual(netstat_summary["target_subnet_routes"][0]["netif"], "bridge100")

        route_summary = _summarize_route_get(
            "   route to: 192.168.5.15\n"
            "destination: 192.168.5.15\n"
            "    gateway: 192.168.5.2\n"
            "  interface: bridge100\n"
            "     source: 192.168.5.1\n"
        )
        self.assertFalse(route_summary["raw_output_persisted"])
        self.assertEqual(route_summary["target"], "192.168.5.15")
        self.assertEqual(route_summary["route_interface"], "bridge100")
        self.assertEqual(route_summary["gateway_scope"], "private")
        self.assertEqual(route_summary["source_scope"], "private")


if __name__ == "__main__":
    unittest.main()
