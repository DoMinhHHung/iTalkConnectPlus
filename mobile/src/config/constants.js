export const getAPIURL = async () => {
  try {
    const savedURL = await AsyncStorage.getItem('api_url');
    if (savedURL) {
      // Ensure we return a string, not an object
      if (typeof savedURL === 'string') {
        // Check if URL has http/https
        if (savedURL.startsWith('http://') || savedURL.startsWith('https://')) {
          console.log(`Using saved API URL: ${savedURL}`);
          return savedURL;
        } else {
          // Add http:// if missing
          console.log(`Adding http:// to saved API URL: ${savedURL}`);
          return `http://${savedURL}`;
        }
      } else {
        console.warn('Saved API URL is not a string, using default');
        return API_URL;
      }
    }
    console.log(`No saved API URL, using default: ${API_URL}`);
    return API_URL;
  } catch (error) {
    console.error('Error getting API URL:', error);
    return API_URL;
  }
}; 