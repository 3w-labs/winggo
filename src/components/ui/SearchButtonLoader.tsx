const SearchButtonLoader = () => (
  <span className="search-button-loader" aria-hidden="true">
    {Array.from({ length: 9 }).map((_, index) => (
      <span key={index} />
    ))}
  </span>
);

export default SearchButtonLoader;
