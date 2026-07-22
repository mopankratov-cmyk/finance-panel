import unittest


def load_test_functions(namespace):
    suite = unittest.TestSuite()
    for name, value in sorted(namespace.items()):
        if name.startswith("test_") and callable(value):
            case = unittest.FunctionTestCase(value)
            case._pankster_test_identity = f"{value.__module__}.{value.__name__}"
            case._pankster_test_name = value.__name__
            suite.addTest(case)
    return suite
