Watcher-side tests that belong in desk-watcher/tests/. Kept here so a desk PR can prove watcher behaviour without
touching the live watcher checkout. Run in a COPY of the watcher:

    cp -r /workspace/desk-watcher/{watcher,tests,data,pytest.ini} /tmp/dw && cp scripts/watcher-tests/*.py /tmp/dw/tests/
    cd /tmp/dw && python3 -m pytest -q -o testpaths=tests tests/test_ladder_rows_inert.py
