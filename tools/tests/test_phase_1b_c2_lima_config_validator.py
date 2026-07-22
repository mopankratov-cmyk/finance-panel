import copy
import tempfile
import unittest
from pathlib import Path

import yaml

from tools.phase_1b_c2_lima_config_validator import DEFAULT_CONFIG, LimaConfigError, validate_config


class Phase1BC2LimaConfigValidatorTests(unittest.TestCase):
    def _write_config(self, config: dict) -> Path:
        handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".yaml", delete=False)
        with handle:
            yaml.safe_dump(config, handle)
            return Path(handle.name)

    def _config(self) -> dict:
        return yaml.safe_load(DEFAULT_CONFIG.read_text(encoding="utf-8"))

    def test_c2_lima_config_validates(self):
        result = validate_config(DEFAULT_CONFIG)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["vm_type"], "vz")
        self.assertEqual(result["host_mounts"], 0)
        self.assertFalse(result["proxy_env_propagation"])
        self.assertFalse(result["host_resolver_enabled"])
        self.assertFalse(result["runtime_start_executed"])

    def test_c2_lima_config_rejects_host_mount(self):
        config = self._config()
        config["mounts"] = [{"location": "~", "writable": False}]
        path = self._write_config(config)
        with self.assertRaises(LimaConfigError) as raised:
            validate_config(path)
        self.assertEqual(str(raised.exception), "HOST_MOUNTS_FORBIDDEN")

    def test_c2_lima_config_rejects_containerd_user(self):
        config = self._config()
        config["containerd"] = copy.deepcopy(config["containerd"])
        config["containerd"]["user"] = True
        path = self._write_config(config)
        with self.assertRaises(LimaConfigError) as raised:
            validate_config(path)
        self.assertEqual(str(raised.exception), "CONTAINERD_MUST_BE_DISABLED")

    def test_c2_lima_config_rejects_mutable_image_url(self):
        config = self._config()
        config["images"][0]["location"] = (
            "https://cloud-images.ubuntu.com/minimal/releases/noble/release/ubuntu-24.04-minimal-cloudimg-arm64.img"
        )
        path = self._write_config(config)
        with self.assertRaises(LimaConfigError) as raised:
            validate_config(path)
        self.assertIn("IMAGE_PIN_MISMATCH", str(raised.exception))

    def test_c2_lima_config_rejects_port_forward(self):
        config = self._config()
        config["portForwards"] = [{"guestPort": 8080, "hostPort": 8080}]
        path = self._write_config(config)
        with self.assertRaises(LimaConfigError) as raised:
            validate_config(path)
        self.assertEqual(str(raised.exception), "PORT_FORWARDS_FORBIDDEN")

    def test_c2_lima_config_rejects_proxy_env_propagation(self):
        config = self._config()
        config["propagateProxyEnv"] = True
        path = self._write_config(config)
        with self.assertRaises(LimaConfigError) as raised:
            validate_config(path)
        self.assertEqual(str(raised.exception), "PROXY_ENV_PROPAGATION_FORBIDDEN")

    def test_c2_lima_config_rejects_guest_env(self):
        config = self._config()
        config["env"] = {"TOKEN": "not-a-real-token"}
        path = self._write_config(config)
        with self.assertRaises(LimaConfigError) as raised:
            validate_config(path)
        self.assertEqual(str(raised.exception), "GUEST_ENV_FORBIDDEN")


if __name__ == "__main__":
    unittest.main()
