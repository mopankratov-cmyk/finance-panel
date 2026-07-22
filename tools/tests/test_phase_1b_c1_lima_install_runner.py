import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from tools.phase_1b_c1_lima_install_runner import (
    DEFAULT_APPROVAL_RECORD,
    DEFAULT_MANIFEST,
    DEFAULT_INSTALL_PREFIX,
    LimaInstallRunnerError,
    inspect_archive,
    preflight,
)


def _write_tar(path: Path, members: dict[str, bytes]) -> None:
    with tarfile.open(path, "w:gz") as archive:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))


class Phase1BC1LimaInstallRunnerTests(unittest.TestCase):
    def test_c1_lima_preflight_passes_without_runtime_start(self):
        result = preflight(DEFAULT_MANIFEST, DEFAULT_APPROVAL_RECORD, DEFAULT_INSTALL_PREFIX)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["synthetic_gate"], "PASS")
        self.assertEqual(result["production_install_state"], "BLOCKED_AUTHENTICATION_BACKEND_PENDING")
        self.assertFalse(result["runtime_start_executed"])
        self.assertFalse(result["guest_image_downloaded"])
        self.assertFalse(result["real_credentials_allowed"])

    def test_c1_lima_runner_rejects_path_traversal_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            archive_path = Path(temp) / "bad.tar.gz"
            _write_tar(archive_path, {"../escape": b"nope"})
            with self.assertRaises(LimaInstallRunnerError) as raised:
                inspect_archive(archive_path)
            self.assertEqual(raised.exception.reason, "ARCHIVE_MEMBER_PATH_REJECTED")

    def test_c1_lima_runner_allows_root_directory_member(self):
        with tempfile.TemporaryDirectory() as temp:
            archive_path = Path(temp) / "root-dir.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                info = tarfile.TarInfo(".")
                info.type = tarfile.DIRTYPE
                archive.addfile(info)
            result = inspect_archive(archive_path)
            self.assertEqual(result["directories"], 1)

    def test_c1_lima_runner_allows_relative_symlink_within_archive_root(self):
        with tempfile.TemporaryDirectory() as temp:
            archive_path = Path(temp) / "safe-link.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                info = tarfile.TarInfo("./share/doc/lima/templates")
                info.type = tarfile.SYMTYPE
                info.linkname = "../../lima/templates"
                archive.addfile(info)
            result = inspect_archive(archive_path)
            self.assertEqual(result["links"], 1)

    def test_c1_lima_runner_rejects_symlink_escaping_archive_root(self):
        with tempfile.TemporaryDirectory() as temp:
            archive_path = Path(temp) / "escape-link.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                info = tarfile.TarInfo("./share/doc/lima/templates")
                info.type = tarfile.SYMTYPE
                info.linkname = "../../../../escape"
                archive.addfile(info)
            with self.assertRaises(LimaInstallRunnerError) as raised:
                inspect_archive(archive_path)
            self.assertEqual(raised.exception.reason, "ARCHIVE_LINK_TARGET_REJECTED")

    def test_c1_lima_approval_record_is_synthetic_only(self):
        record = json.loads(DEFAULT_APPROVAL_RECORD.read_text(encoding="utf-8"))
        self.assertTrue(record["synthetic_only"])
        self.assertFalse(record["real_credentials_allowed"])
        self.assertFalse(record["production_profiles_allowed"])
        self.assertEqual(record["authn_context"], "interactive-synthetic")


if __name__ == "__main__":
    unittest.main()
