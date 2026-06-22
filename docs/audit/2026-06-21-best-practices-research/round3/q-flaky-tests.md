Contents Menu Expand Light mode Dark mode Auto light/dark, in light mode Auto light/dark, in dark mode [Skip to content](https://docs.pytest.org/en/stable/how-to/skipping.html#furo-main-content)
[pytest documentation](https://docs.pytest.org/en/stable/index.html)
[ ![Logo](https://docs.pytest.org/en/stable/_static/pytest1.png) ](https://docs.pytest.org/en/stable/index.html)
  * [Get Started](https://docs.pytest.org/en/stable/getting-started.html)
  * [How-to guides](https://docs.pytest.org/en/stable/how-to/index.html)
    * [How to invoke pytest](https://docs.pytest.org/en/stable/how-to/usage.html)
    * [How to write and report assertions in tests](https://docs.pytest.org/en/stable/how-to/assert.html)
    * [How to use fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html)
    * [How to mark test functions with attributes](https://docs.pytest.org/en/stable/how-to/mark.html)
    * [How to parametrize fixtures and test functions](https://docs.pytest.org/en/stable/how-to/parametrize.html)
    * [How to use subtests](https://docs.pytest.org/en/stable/how-to/subtests.html)
    * [How to use temporary directories and files in tests](https://docs.pytest.org/en/stable/how-to/tmp_path.html)
    * [How to monkeypatch/mock modules and environments](https://docs.pytest.org/en/stable/how-to/monkeypatch.html)
    * [How to run doctests](https://docs.pytest.org/en/stable/how-to/doctest.html)
    * [How to re-run failed tests and maintain state between test runs](https://docs.pytest.org/en/stable/how-to/cache.html)
    * [How to handle test failures](https://docs.pytest.org/en/stable/how-to/failures.html)
    * [Managing pytest’s output](https://docs.pytest.org/en/stable/how-to/output.html)
    * [How to manage logging](https://docs.pytest.org/en/stable/how-to/logging.html)
    * [How to capture stdout/stderr output](https://docs.pytest.org/en/stable/how-to/capture-stdout-stderr.html)
    * [How to capture warnings](https://docs.pytest.org/en/stable/how-to/capture-warnings.html)
    * [How to use skip and xfail to deal with tests that cannot succeed](https://docs.pytest.org/en/stable/how-to/skipping.html)
    * [How to install and use plugins](https://docs.pytest.org/en/stable/how-to/plugins.html)
    * [Writing plugins](https://docs.pytest.org/en/stable/how-to/writing_plugins.html)
    * [Writing hook functions](https://docs.pytest.org/en/stable/how-to/writing_hook_functions.html)
    * [How to use pytest with an existing test suite](https://docs.pytest.org/en/stable/how-to/existingtestsuite.html)
    * [How to use `unittest`-based tests with pytest](https://docs.pytest.org/en/stable/how-to/unittest.html)
    * [How to implement xunit-style set-up](https://docs.pytest.org/en/stable/how-to/xunit_setup.html)
    * [How to set up bash completion](https://docs.pytest.org/en/stable/how-to/bash-completion.html)
  * [Reference guides](https://docs.pytest.org/en/stable/reference/index.html)
    * [API Reference](https://docs.pytest.org/en/stable/reference/reference.html)
    * [Fixtures reference](https://docs.pytest.org/en/stable/reference/fixtures.html)
    * [Configuration](https://docs.pytest.org/en/stable/reference/customize.html)
    * [Exit codes](https://docs.pytest.org/en/stable/reference/exit-codes.html)
    * [Pytest Plugin List](https://docs.pytest.org/en/stable/reference/plugin_list.html)
  * [Explanation](https://docs.pytest.org/en/stable/explanation/index.html)
    * [Anatomy of a test](https://docs.pytest.org/en/stable/explanation/anatomy.html)
    * [About fixtures](https://docs.pytest.org/en/stable/explanation/fixtures.html)
    * [Good Integration Practices](https://docs.pytest.org/en/stable/explanation/goodpractices.html)
    * [pytest import mechanisms and `sys.path`/`PYTHONPATH`](https://docs.pytest.org/en/stable/explanation/pythonpath.html)
    * [Typing in pytest](https://docs.pytest.org/en/stable/explanation/types.html)
    * [CI Pipelines](https://docs.pytest.org/en/stable/explanation/ci.html)
    * [Flaky tests](https://docs.pytest.org/en/stable/explanation/flaky.html)
  * [Examples and customization tricks](https://docs.pytest.org/en/stable/example/index.html)
    * [Demo of Python failure reports with pytest](https://docs.pytest.org/en/stable/example/reportingdemo.html)
    * [Basic patterns and examples](https://docs.pytest.org/en/stable/example/simple.html)
    * [Parametrizing tests](https://docs.pytest.org/en/stable/example/parametrize.html)
    * [Working with custom markers](https://docs.pytest.org/en/stable/example/markers.html)
    * [A session-fixture which can look at all collected tests](https://docs.pytest.org/en/stable/example/special.html)
    * [Changing standard (Python) test discovery](https://docs.pytest.org/en/stable/example/pythoncollection.html)
    * [Working with non-python tests](https://docs.pytest.org/en/stable/example/nonpython.html)
    * [Using a custom directory collector](https://docs.pytest.org/en/stable/example/customdirectory.html)


About the project
  * [Changelog](https://docs.pytest.org/en/stable/changelog.html)
  * [Contributing](https://docs.pytest.org/en/stable/contributing.html)
  * [Backwards Compatibility Policy](https://docs.pytest.org/en/stable/backwards-compatibility.html)
  * [History](https://docs.pytest.org/en/stable/backwards-compatibility.html#history)
  * [Python version support](https://docs.pytest.org/en/stable/backwards-compatibility.html#python-version-support)
  * [Sponsor](https://docs.pytest.org/en/stable/sponsor.html)
  * [pytest for enterprise](https://docs.pytest.org/en/stable/tidelift.html)
  * [License](https://docs.pytest.org/en/stable/license.html)
  * [Contact channels](https://docs.pytest.org/en/stable/contact.html)


Useful links
  * [pytest @ PyPI](https://pypi.org/project/pytest/)
  * [pytest @ GitHub](https://github.com/pytest-dev/pytest/)
  * [Issue Tracker](https://github.com/pytest-dev/pytest/issues)
  * [PDF Documentation](https://media.readthedocs.org/pdf/pytest/latest/pytest.pdf)


[ Back to top ](https://docs.pytest.org/en/stable/how-to/skipping.html)
# How to use skip and xfail to deal with tests that cannot succeed[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#how-to-use-skip-and-xfail-to-deal-with-tests-that-cannot-succeed "Link to this heading")
You can mark test functions that cannot be run on certain platforms or that you expect to fail so pytest can deal with them accordingly and present a summary of the test session, while keeping the test suite _green_.
A **skip** means that you expect your test to pass only if some conditions are met, otherwise pytest should skip running the test altogether. Common examples are skipping windows-only tests on non-windows platforms, or skipping tests that depend on an external resource which is not available at the moment (for example a database).
An **xfail** means that you expect a test to fail for some reason. A common example is a test for a feature not yet implemented, or a bug not yet fixed. When a test passes despite being expected to fail (marked with `pytest.mark.xfail`), it’s an **xpass** and will be reported in the test summary.
`pytest` counts and lists _skip_ and _xfail_ tests separately. Detailed information about skipped/xfailed tests is not shown by default to avoid cluttering the output. You can use the [`-r`](https://docs.pytest.org/en/stable/reference/reference.html#cmdoption-r) option to see details corresponding to the “short” letters shown in the test progress:

```
pytest -rxXs  # show extra info on xfailed, xpassed, and skipped tests

```

More details on the [`-r`](https://docs.pytest.org/en/stable/reference/reference.html#cmdoption-r) option can be found by running `pytest -h`.
(See [Builtin configuration file options](https://docs.pytest.org/en/stable/reference/customize.html#how-to-change-command-line-options-defaults))
## Skipping test functions[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#skipping-test-functions "Link to this heading")
The simplest way to skip a test function is to mark it with the `skip` decorator which may be passed an optional `reason`:

```
@pytest.mark.skip(reason="no way of currently testing this")
def test_the_unknown(): ...

```

Alternatively, it is also possible to skip imperatively during test execution or setup by calling the `pytest.skip(reason)` function:

```
def test_function():
    if not valid_config():
        pytest.skip("unsupported configuration")

```

The imperative method is useful when it is not possible to evaluate the skip condition during import time.
It is also possible to skip the whole module using `pytest.skip(reason, allow_module_level=True)` at the module level:

```
import sys

import pytest

if not sys.platform.startswith("win"):
    pytest.skip("skipping windows-only tests", allow_module_level=True)

```

**Reference** : [pytest.mark.skip](https://docs.pytest.org/en/stable/reference/reference.html#pytest-mark-skip-ref)
###  `skipif`[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#id1 "Link to this heading")
If you wish to skip something conditionally then you can use `skipif` instead. Here is an example of marking a test function to be skipped when run on an interpreter earlier than Python3.13:

```
import sys


@pytest.mark.skipif(sys.version_info < (3, 13), reason="requires python3.13 or higher")
def test_function(): ...

```

If the condition evaluates to `True` during collection, the test function will be skipped, with the specified reason appearing in the summary when using `-rs`.
You can share `skipif` markers between modules. Consider this test module:

```
# content of test_mymodule.py
import mymodule

minversion = pytest.mark.skipif(
    mymodule.__versioninfo__ < (1, 1), reason="at least mymodule-1.1 required"
)


@minversion
def test_function(): ...

```

You can import the marker and reuse it in another test module:

```
# test_myothermodule.py
from test_mymodule import minversion


@minversion
def test_anotherfunction(): ...

```

For larger test suites it’s usually a good idea to have one file where you define the markers which you then consistently apply throughout your test suite.
Alternatively, you can use [condition strings](https://docs.pytest.org/en/stable/historical-notes.html#string-conditions) instead of booleans, but they can’t be shared between modules easily so they are supported mainly for backward compatibility reasons.
**Reference** : [pytest.mark.skipif](https://docs.pytest.org/en/stable/reference/reference.html#pytest-mark-skipif-ref)
### Skip all test functions of a class or module[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#skip-all-test-functions-of-a-class-or-module "Link to this heading")
You can use the `skipif` marker (as any other marker) on classes:

```
@pytest.mark.skipif(sys.platform == "win32", reason="does not run on windows")
class TestPosixCalls:
    def test_function(self):
        "will not be setup or run under 'win32' platform"

```

If the condition is `True`, this marker will produce a skip result for each of the test methods of that class.
If you want to skip all test functions of a module, you may use the [`pytestmark`](https://docs.pytest.org/en/stable/reference/reference.html#globalvar-pytestmark) global:

```
# test_module.py
pytestmark = pytest.mark.skipif(...)

```

If multiple `skipif` decorators are applied to a test function, it will be skipped if any of the skip conditions is true.
### Skipping files or directories[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#skipping-files-or-directories "Link to this heading")
Sometimes you may need to skip an entire file or directory, for example if the tests rely on Python version-specific features or contain code that you do not wish pytest to run. In this case, you must exclude the files and directories from collection. Refer to [Customizing test collection](https://docs.pytest.org/en/stable/example/pythoncollection.html#customizing-test-collection) for more information.
### Skipping on a missing import dependency[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#skipping-on-a-missing-import-dependency "Link to this heading")
You can skip tests on a missing import by using [pytest.importorskip](https://docs.pytest.org/en/stable/reference/reference.html#pytest-importorskip-ref) at module level, within a test, or test setup function.

```
docutils = pytest.importorskip("docutils")

```

If `docutils` cannot be imported here, this will lead to a skip outcome of the test. You can also skip based on the version number of a library:

```
docutils = pytest.importorskip("docutils", minversion="0.3")

```

The version will be read from the specified module’s `__version__` attribute.
### Summary[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#summary "Link to this heading")
Here’s a quick guide on how to skip tests in a module in different situations:
  1. Skip all tests in a module unconditionally:


> 
```
pytestmark = pytest.mark.skip("all tests still WIP")

```

  1. Skip all tests in a module based on some condition:


> 
```
pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="tests for linux only")

```

  1. Skip all tests in a module if some import is missing:


> 
```
pexpect = pytest.importorskip("pexpect")

```

## XFail: mark test functions as expected to fail[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#xfail-mark-test-functions-as-expected-to-fail "Link to this heading")
You can use the `xfail` marker to indicate that you expect a test to fail:

```
@pytest.mark.xfail
def test_function(): ...

```

This test will run but no traceback will be reported when it fails. Instead, terminal reporting will list it in the “expected to fail” (`XFAIL`) or “unexpectedly passing” (`XPASS`) sections.
Alternatively, you can also mark a test as `XFAIL` from within the test or its setup function imperatively:

```
def test_function():
    if not valid_config():
        pytest.xfail("failing configuration (but should work)")

```


```
def test_function2():
    import slow_module

    if slow_module.slow_function():
        pytest.xfail("slow_module taking too long")

```

These two examples illustrate situations where you don’t want to check for a condition at the module level, which is when a condition would otherwise be evaluated for marks.
This will make `test_function` `XFAIL`. Note that no other code is executed after the [`pytest.xfail()`](https://docs.pytest.org/en/stable/reference/reference.html#pytest.xfail "pytest.xfail") call, differently from the marker. That’s because it is implemented internally by raising a known exception.
**Reference** : [pytest.mark.xfail](https://docs.pytest.org/en/stable/reference/reference.html#pytest-mark-xfail-ref)
###  `condition` parameter[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#condition-parameter "Link to this heading")
If a test is only expected to fail under a certain condition, you can pass that condition as the first parameter:

```
@pytest.mark.xfail(sys.platform == "win32", reason="bug in a 3rd party library")
def test_function(): ...

```

Note that you have to pass a reason as well (see the parameter description at [pytest.mark.xfail](https://docs.pytest.org/en/stable/reference/reference.html#pytest-mark-xfail-ref)).
###  `reason` parameter[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#reason-parameter "Link to this heading")
You can specify the motive of an expected failure with the `reason` parameter:

```
@pytest.mark.xfail(reason="known parser issue")
def test_function(): ...

```

###  `raises` parameter[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#raises-parameter "Link to this heading")
If you want to be more specific as to why the test is failing, you can specify a single exception, or a tuple of exceptions, in the `raises` argument.

```
@pytest.mark.xfail(raises=RuntimeError)
def test_function(): ...

```

Then the test will be reported as a regular failure if it fails with an exception not mentioned in `raises`.
###  `run` parameter[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#run-parameter "Link to this heading")
If a test should be marked as xfail and reported as such but should not be even executed, use the `run` parameter as `False`:

```
@pytest.mark.xfail(run=False)
def test_function(): ...

```

This is particularly useful for xfailing tests that are crashing the interpreter and should be investigated later.
###  `strict` parameter[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#strict-parameter "Link to this heading")
Both `XFAIL` and `XPASS` don’t fail the test suite by default. You can change this by setting the `strict` keyword-only parameter to `True`:

```
@pytest.mark.xfail(strict=True)
def test_function(): ...

```

This will make `XPASS` (“unexpectedly passing”) results from this test to fail the test suite.
You can change the default value of the `strict` parameter using the `strict_xfail` ini option:
toml

```
[pytest]
xfail_strict = true

```

ini

```
[pytest]
strict_xfail = true

```

### Ignoring xfail[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#ignoring-xfail "Link to this heading")
By specifying on the commandline:

```
pytest --runxfail

```

you can force the running and reporting of an `xfail` marked test as if it weren’t marked at all. This also causes [`pytest.xfail()`](https://docs.pytest.org/en/stable/reference/reference.html#pytest.xfail "pytest.xfail") to produce no effect.
### Examples[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#examples "Link to this heading")
Here is a simple test file with the several usages:

```
from __future__ import annotations

import pytest


xfail = pytest.mark.xfail


@xfail
def test_hello():
    assert 0


@xfail(run=False)
def test_hello2():
    assert 0


@xfail("hasattr(os, 'sep')")
def test_hello3():
    assert 0


@xfail(reason="bug 110")
def test_hello4():
    assert 0


@xfail('pytest.__version__[0] != "17"')
def test_hello5():
    assert 0


def test_hello6():
    pytest.xfail("reason")


@xfail(raises=IndexError)
def test_hello7():
    x = []
    x[1] = 1

```

Running it with the report-on-xfail option gives this output:

```
! pytest -rx xfail_demo.py
=========================== test session starts ============================
platform linux -- Python 3.x.y, pytest-6.x.y, py-1.x.y, pluggy-1.x.y
cachedir: $PYTHON_PREFIX/.pytest_cache
rootdir: $REGENDOC_TMPDIR/example
collected 7 items

xfail_demo.py xxxxxxx                                                [100%]

========================= short test summary info ==========================
XFAIL xfail_demo.py::test_hello
XFAIL xfail_demo.py::test_hello2
  reason: [NOTRUN]
XFAIL xfail_demo.py::test_hello3
  condition: hasattr(os, 'sep')
XFAIL xfail_demo.py::test_hello4
  bug 110
XFAIL xfail_demo.py::test_hello5
  condition: pytest.__version__[0] != "17"
XFAIL xfail_demo.py::test_hello6
  reason: reason
XFAIL xfail_demo.py::test_hello7
============================ 7 xfailed in 0.12s ============================

```

## Skip/xfail with parametrize[¶](https://docs.pytest.org/en/stable/how-to/skipping.html#skip-xfail-with-parametrize "Link to this heading")
It is possible to apply markers like skip and xfail to individual test instances when using parametrize:

```
import sys

import pytest


@pytest.mark.parametrize(
    ("n", "expected"),
    [
        (1, 2),
        pytest.param(1, 0, marks=pytest.mark.xfail),
        pytest.param(1, 3, marks=pytest.mark.xfail(reason="some bug")),
        (2, 3),
        (3, 4),
        (4, 5),
        pytest.param(
            10, 11, marks=pytest.mark.skipif(sys.version_info >= (3, 0), reason="py2k")
        ),
    ],
)
def test_increment(n, expected):
    assert n + 1 == expected

```

[ Next How to install and use plugins ](https://docs.pytest.org/en/stable/how-to/plugins.html) [ Previous How to capture warnings ](https://docs.pytest.org/en/stable/how-to/capture-warnings.html)
Copyright © 2015, holger krekel and pytest-dev team 
Made with [Sphinx](https://www.sphinx-doc.org/) and [@pradyunsg](https://pradyunsg.me)'s [Furo](https://github.com/pradyunsg/furo)
On this page 
  * [How to use skip and xfail to deal with tests that cannot succeed](https://docs.pytest.org/en/stable/how-to/skipping.html)
    * [Skipping test functions](https://docs.pytest.org/en/stable/how-to/skipping.html#skipping-test-functions)
      * [`skipif`](https://docs.pytest.org/en/stable/how-to/skipping.html#id1)
      * [Skip all test functions of a class or module](https://docs.pytest.org/en/stable/how-to/skipping.html#skip-all-test-functions-of-a-class-or-module)
      * [Skipping files or directories](https://docs.pytest.org/en/stable/how-to/skipping.html#skipping-files-or-directories)
      * [Skipping on a missing import dependency](https://docs.pytest.org/en/stable/how-to/skipping.html#skipping-on-a-missing-import-dependency)
      * [Summary](https://docs.pytest.org/en/stable/how-to/skipping.html#summary)
    * [XFail: mark test functions as expected to fail](https://docs.pytest.org/en/stable/how-to/skipping.html#xfail-mark-test-functions-as-expected-to-fail)
      * [`condition` parameter](https://docs.pytest.org/en/stable/how-to/skipping.html#condition-parameter)
      * [`reason` parameter](https://docs.pytest.org/en/stable/how-to/skipping.html#reason-parameter)
      * [`raises` parameter](https://docs.pytest.org/en/stable/how-to/skipping.html#raises-parameter)
      * [`run` parameter](https://docs.pytest.org/en/stable/how-to/skipping.html#run-parameter)
      * [`strict` parameter](https://docs.pytest.org/en/stable/how-to/skipping.html#strict-parameter)
      * [Ignoring xfail](https://docs.pytest.org/en/stable/how-to/skipping.html#ignoring-xfail)
      * [Examples](https://docs.pytest.org/en/stable/how-to/skipping.html#examples)
    * [Skip/xfail with parametrize](https://docs.pytest.org/en/stable/how-to/skipping.html#skip-xfail-with-parametrize)


[**Build and run** apps in over 115 regions with MongoDB Atlas, the database for every enterprise.](https://server.ethicalads.io/proxy/click/10500/019eecc4-56c2-7523-a78d-c4ddb416ad82/)
[Ads by EthicalAds](https://www.ethicalads.io/advertisers/?ref=ea-text)
Close Ad
![](https://server.ethicalads.io/proxy/view/10500/019eecc4-56c2-7523-a78d-c4ddb416ad82/)
