package com.example;

import java.util.List;
import com.example.store.Row;
import static com.example.store.Row.EMPTY;

/* import com.example.never.Extracted; */
// import com.example.also.NotExtracted;

public class Widget {
    // A text block containing what reads exactly like an import.
    static final String SAMPLE = """
        import com.example.in.A.TextBlock;
        """;
    public List<Row> rows() { return List.of(new Row(EMPTY)); }
}
