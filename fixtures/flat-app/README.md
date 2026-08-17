# flat-app

A single package with no atlas config and no test suite. It exists so the
graceful-degradation guarantees have a target CI can enforce without the
validation corpus: every node still lands in a declared service, coverage
reads as "not measured" rather than "untested", and the map is not blank.
