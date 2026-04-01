const url = "https://lh3.googleusercontent.com/fife/ALs6j_GSomeId=w100-h125";
const url2 = "https://lh3.googleusercontent.com/fife/ALs6j_GSomeId=s100-c";
function clean(urlStr) {
    try {
        const u = new URL(urlStr);
        if (u.hostname.endsWith('.googleusercontent.com') || u.hostname === 'googleusercontent.com') {
            // The size parameters are usually in the pathname if there's no query string,
            // or sometimes they are added as query parameters. Wait, in googleusercontent they are typically appended with '=' in the *pathname*.
            // e.g. /a/ALm5wu3=s100
            // BUT URL constructor might encode or parse them differently. 
            // In URL API, `u.pathname` will be `/fife/ALs6j_GSomeId=w100-h125`
            u.pathname = u.pathname.replace(/=[wsh]\d+.*$/, '=s0');
            return u.toString();
        }
    } catch(e){}
    return urlStr;
}
console.log(clean(url));
console.log(clean(url2));
