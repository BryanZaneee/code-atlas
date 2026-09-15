package com.example

// A wildcard names the package, so this resolves to BOTH files in store/.
import com.example.store.*
import com.example.Widget as W
import kotlin.collections.List

class Report(private val w: W) {
    val raw = """
        import com.example.in.A.RawString
    """
    fun rows(): List<Row> = w.rows()
    fun table(): Table = Table()
}
