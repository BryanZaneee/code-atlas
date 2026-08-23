# app/<subdir> is conventionally on the Rails load path, and so is lib/. The
# bare `require "store/row"` below therefore resolves under lib/ with no prefix,
# which is the whole point of inferring a load path rather than reading one.
require_relative "../../lib/widget"
require "store/row"
require "rails/all"

class Document
  # A string containing a require, which must not be extracted.
  TEMPLATE = 'require "in_a_string"'
end
