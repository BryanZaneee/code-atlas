=begin
A block comment that contains what looks exactly like a require:

  require "nokogiri/never/extracted"

If the blanker misses =begin/=end, that becomes a real external edge.
=end

# require "also_not_extracted"

class Row
  def to_s = "row"      # require "still_not_extracted"
end
