//let userCountry;
//let providers;
let tabID;

//find the most recent tab/ tab we are on
//react on url-changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!isIMDbTitlePageLoadComplete(changeInfo, tab)) return;

    const imdbId = extractImdbId(tab.url);
    if (!imdbId) return;

    console.log("Finaler Seitenaufruf:", tab.url);
    fetchStreamingDataForTitleTtPage(["all"], [imdbId], tabId);
});

function isIMDbTitlePageLoadComplete(changeInfo, tab) {
    return (
        changeInfo.status === "complete" &&
        tab.url &&
        (tab.url.includes("imdb.com/") && tab.url.includes("/title/tt") ) 
    );
}

function extractImdbId(url) {
    const match = url.match(/\/title\/(tt\d+)/);
    return match ? match[1] : null;
}


chrome.runtime.onMessage.addListener(obj => {
    const {event, data} = obj;
    console.log(obj);
    switch(obj.event){
        case 'sendingPrefs':
            //providers = data.service;
            sendingTitletoCS(data);
            break;
        case 'titlesGrabbed':
            console.log("api call ", data)
            console.log(obj.serviceSelection);
            apiCall(obj.serviceSelection, obj.arr);
            break;
        case 'getMore':
            sendingGetMore(data);
            break;    
        default:
            break;
    }
})

const sendingTitletoCS = (prefs) => {
    console.log("sendingTitletoCS background");
    console.log("prefs:", prefs);
    console.log(prefs.tabInfo.id);
    
    tabID = prefs.tabInfo.id;
    console.log("waiting for the tab to load:", tabID);

    chrome.tabs.get(tabID, (tab) => {
        if (chrome.runtime.lastError) {
            console.error("Error getting tab:", chrome.runtime.lastError);
            return;
        }

        if (tab.status === 'complete') {
            console.log("Tab already loaded, sending message immediately...");
            sendGrabTitlesMessage(prefs);
        } else {
            console.log("Tab not yet loaded, waiting for 'complete' status...");
            const onTabUpdatedListener = (updatedTabId, changeInfo, updatedTab) => {
                if (updatedTabId === tabID && changeInfo.status === 'complete') {
                    console.log("Tab fully loaded, sending message...");
                    sendGrabTitlesMessage(prefs)
                    chrome.tabs.onUpdated.removeListener(onTabUpdatedListener);
                }
            };
            chrome.tabs.onUpdated.addListener(onTabUpdatedListener);
        }
    });
};

const sendGrabTitlesMessage = (prefs) => {
    chrome.tabs.sendMessage(tabID, {
        event: "grabTitles",
        serviceSelection: prefs.service
    });
};

const sendingGetMore = (prefs) => {
    console.log("sendingGetMore");
    console.log(prefs);
    chrome.tabs.sendMessage(prefs.tabInfo.id, {
        event: "getMore",
        serviceSelection: prefs.service
    })
}

const apiCall = (serviceSelection, arr) => {
    console.log("Service selection:", serviceSelection);
    fetchStreamingData(serviceSelection, arr, tabID, "streamingResults");
};

const fetchStreamingDataForTitleTtPage = (serviceSelection, titlesIds, tabId) => {
    fetchStreamingData(serviceSelection, titlesIds, tabId, "titleTT");
};

const fetchStreamingData = async (serviceSelection, titlesIds, tabId, eventName) => {
    console.log("Fetching streaming data for titles:", titlesIds);

    try {
        const response = await fetch("http://ip-api.com/json/?fields=61439");
        const data = await response.json();
        const userCountry = data.countryCode.toLowerCase();

        for (let titleId of titlesIds) {
            try {
                const titleData = await fetchStreamingDataProvider(serviceSelection, titleId);
                chrome.tabs.sendMessage(tabId, {
                    event: eventName,
                    data: {
                        userCountry,
                        titles: titleData
                    }
                });
            } catch (err) {
                console.error("Fehler bei Titel:", titleId, err);
            }
        }
    } catch (err) {
        console.error("Fehler beim Ermitteln des Landes:", err);
    }
};



const fetchStreamingDataProvider = async (serviceSelection, titleId) => {
    const url = `https://streaming-availability.p.rapidapi.com/shows/${titleId}`
    // const url = `https://streaming-availability.p.rapidapi.com/shows/${"tt4093826"}`
    const options = {
        method: 'GET',
        headers: {
            'X-RapidAPI-Key': "yourAPIkey",
            'X-RapidAPI-Host': 'streaming-availability.p.rapidapi.com'
        }//10b8f8f786mshe30857c4324f0f4p1148d8jsn82737f5ed98c
    };//c8d3390269mshbc036e9d1af7511p1108fajsn19442eccb00e

    try{
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Error fetching streaming data for ${titleId}: Status ${response.status}, Error: ${errorBody}`);
            if(response.status === 404){
                return {titleId: titleId, notFound: true}
            }
            throw new Error(`Network response was not ok: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(data);
        console.log(data.imdbId);
        console.log(data.originalTitle);
        
        const result = {
            titleId: data.imdbId,
            titleName: data.originalTitle,
            streamingOptions: extractStreamingOptions(data.streamingOptions, serviceSelection)
        };

        
        console.log(result);
        return result;
        
    }catch (err) {
        console.error('Error:', err);
        return null;
    }
}

const extractStreamingOptions = (streamingOptions, serviceSelection) => {
    if (!streamingOptions) return [];

    const result = [];

    for (const [country, services] of Object.entries(streamingOptions)) {
        if (!Array.isArray(services) || services.length === 0) continue;

        const filteredServices = services
            .filter(service => {
                const id = service.service.id;
                const isSubscription = service.type === "subscription";
                const isFree = service.type === "free";
                const inSelection = serviceSelection.includes(id);
                const includeAll = serviceSelection.includes("all");

                return includeAll
                    ? (isSubscription || isFree)
                    : (isFree || (isSubscription && inSelection));
            })
            .map(service => ({
                name: service.service.name,
                link: service.link,
                type: service.type
            }));

        if (filteredServices.length > 0) {
            result.push({
                country,
                services: filteredServices
            });
        }
    }

    return result.sort((a, b) => a.country.localeCompare(b.country));
};


//send api calls results back to contentScript 
/*
let dataDummy = {
    "itemType": "show",
    "showType": "movie",
    "id": "82",
    "imdbId": "tt0068646",
    "tmdbId": "movie/238",
    "title": "The Godfather",
    "overview": "Winner of three Academy Awards including Best Picture, Francis Ford Coppola's epic masterpiece paints a chilling portrait of the Corleone family, balancing the story between their family life and the ugly crime business in which they are engaged.",
    "releaseYear": 1972,
    "originalTitle": "The Godfather",
    "genres": [
        {
            "id": "crime",
            "name": "Crime"
        },
        {
            "id": "drama",
            "name": "Drama"
        }
    ],
    "directors": [
        "Francis Ford Coppola"
    ],
    "cast": [
        "Marlon Brando",
        "Al Pacino",
        "James Caan",
        "Robert Duvall",
        "Richard S. Castellano",
        "Diane Keaton",
        "Talia Shire"
    ],
    "rating": 88,
    "runtime": 176,
    "imageSet": {
        "verticalPoster": {
            "w240": "https://cdn.movieofthenight.com/show/82/poster/vertical/en/240.jpg?Expires=1769129511&Signature=PFmTmedc-Sy8opsZWHkTRfoSoF~AvEa-CI6-lB3qh0qQqMd16w9QuRgN0FuVOlq5xf2u2KLy--ZmTS~EuGhLMuzI0yc5KNvXco~6grJLghZktV5a3uS2z2Yxozoei-2iFA0EgIOwgLowQ5zLOgPTMNRFdR~ZFvdQpe1BzgQ-SvZPENs8Wk2wBaVwUAzdB-TnF8iqCCNU-UMAqfRWH9NQFbr3KxfwLv0IxgFlHrqo7Jy68JKpwxEv56QLHboudcoLkwf~KBWeMFSP0UaXVCpaf54EHJcph2FmT934v1uXZWg2TJicur~yQi7CqjUdqxigfpvLl~z6zCCa~GEhj4dFoA__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w360": "https://cdn.movieofthenight.com/show/82/poster/vertical/en/360.jpg?Expires=1769129511&Signature=QBW59JAWithwEsprdOdOWei8wnkS2Us2MdfXWKcnJRsNj4nfNFFIgpE3jLzQm~zwoVEkUbAJOjDaVXExqb9g2NXoZlE5aLgxXwmy~Yk7rcZuVM9x5QtCxDOxDSH6p2JCmco9imprhhjJjZfalfw~W2W8s1DvRh8TteF~uFxvL4g5xAyo49bkIwZ5~2mw-EJqGfvG6wZhJhYRLUhkHAGpFJtFTvueQdihpA7CdGQD1wum9bEkyvXe670tlazBZXYTGfzKFoRXT9y7uVmh4ULwMrabvAHAfsInKn1qt2B99qaa10~2AteR4BQhvR63uVakBXyXAQ3W1NVrN8F9axIeeQ__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w480": "https://cdn.movieofthenight.com/show/82/poster/vertical/en/480.jpg?Expires=1769129511&Signature=NDZGk5LpAf1FEFA1p4MUNETCNaI-F3XOl~~pQCJLWR7X61WDmeg-8DzQcp92hqX2ZyLhgYKyTS9k6cd098-AJ~GUO4iolr6eNhI4n~d0WHVVj~kyEOJz4faotJ~YG7WImf2rBf4D02zHrkKm8BnvigYVPTraPT93WLkfd919hGsbgf3adpcoznx9cmYWF8FLx8yGsb0TfLLg0sVzJwoUmXkrBnkFbs4W5AUS3a8JY8-OgtRV798iWaFPLxH6VMm~ZO26HO2zKaVtOLSMdxjl9hQkMLVGp1CtjBZK1ArkM9mIirkAA0Az019OMStKDsvG08jtWpywOHdr9hgIqbpWEw__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w600": "https://cdn.movieofthenight.com/show/82/poster/vertical/en/600.jpg?Expires=1769129511&Signature=IWuhIpocKvhe~TfEnRH9eiZQGG4AWYLUg8iS9p5Mj-2YSLHyQ-og8mvdAHWOVCpla2lB1LssQkeoGBWxB~MnoCkpYcyMgz21oMveryF-JIuLTS6e2C6rbAGVV35Fwn4RWufa52LkJ-MmJAcfhNRUZldLOos73ZrRrze~6dbzwRRmjV2sM~Ek9zVpArP10ha8wKxAFKKxcCSGT548k9Q8lZsHtENVz19HZ10KxQktYV~i0F-7EOj7iYAS9d3q0lbhIwFKEqaNw-rNhIqTH9CmJrVqggWSyywp4z2F-B2Zs2Njyay9V1K4OnZOaITWV5yC53ZC2rBFNZALrn~9VwpPaw__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w720": "https://cdn.movieofthenight.com/show/82/poster/vertical/en/720.jpg?Expires=1769129511&Signature=EsBy140vUWw0CUnkGN21wr-dBimK-M0xY~wFCryh3ZeM-nGcJrsVHmC-aOxxhJxCUMDlfTtm5y2IxcRo4cGy8ZuDC8es1xFhQ-D90PhoBV4ul7nZc6gtYBiRYkZUZXvkPo5FaynvoKLr0eB6xIxGIrhoeSBnYPM0YNrDIHmhHu59Bw8WAse3rZYROkR1YiGb3q8erivO~bfwY2r2gj8uP4961YtVgY9y8pQigWaAdNdDpBBUWIR0KxLsOJU323RorHcneI8mPaYMqmBMeSDFYW8hnp8Thl5-D3eIL-2vj1RzFkUpF4HqDwPyQYMnRqjURnhel3zAFgoFlABN2lPO0A__&Key-Pair-Id=KK4HN3OO4AT5R"
        },
        "horizontalPoster": {
            "w360": "https://cdn.movieofthenight.com/show/82/poster/horizontal/en/360.jpg?Expires=1769129517&Signature=gwVUdDr2uP7zIuTbpSo0L53Jt5e8AeD-C0nBGbjaUo89UwA2fGb5S1tfiiTBGSpQDxXTUz3B-VbMP5uStQWgH0q0uyCjMf2I1XbEfK6WazBii730YYmEOSh2-Brb3r5-Gt0eohLOAjlGFUWCDH~eVAXI2ljdswhECg-1UYNHli5BYC07kZaZatp6CIyltXuVHPNX0DfkpaT1xafj8uY4WovxPyEOFMuVNJqsMKESISoOy8S-mQhjRXfYoGOI4pPfcNo8ok4Q6LCKjC5HyeZLDj453vs11S2ldguayGkj-dDANSRpNeWvrYKWqOTGyTMOH5qg1jD-tIWBQGOi-H23Zg__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w480": "https://cdn.movieofthenight.com/show/82/poster/horizontal/en/480.jpg?Expires=1769129517&Signature=C7NUO0M70impQiPRnODwSs0mBLIdnXVG2IbE6qbrnQlCygrMAaZP3ArI7Y65d5GhOSqLZFuLgpSM~UbPCs3hBVWRQ02-r30Lo73J9BaQyt4GlqOn45MNou6Akv6Fq0hfBoQno9PH3ShHVk0d4EhNnMY3cQyRFuStJKrsxZt6x~mE3QX1YGqWJhS80eWepVnuFoTo05GJ8VRuOrRuosWGopHZjdWWG6FjKkUrf3Do6DuhPbDkFMtjE3m3-yP5m1-zMfaDitDQw7hkUibEPGOxbJ7BePcD~WDQR8OPNztVQl0duJHvKiVbgx8-gRib0dKKAvuHurCeTm3pnEARyLZibg__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w720": "https://cdn.movieofthenight.com/show/82/poster/horizontal/en/720.jpg?Expires=1769129517&Signature=BEABAeIlixYK9INS70NERe8dVmsV9xGa0AdSFUPdS9AuBK517kmbpzAXXVvxdla2He92gwEownbUBXtKzBrqeinh3TV-lvqUeWLKwK9F6YGohrQCD7DIU9PkG4gCZTba0-L3wVoRSJgnufYbi8s9gxlPQ-rDFDlJUfN0cPdHYD5Y-Eoj5DZGqXV2wHum1sKbsupfnAyIlgApMqMPftK4lNlEEkWjNPidpSylvhfT8BFL7m3tzLScUqfng0mHYiANazPyQZTsz3sHGfjVUgAFj4H6w-iEqnDZkDosZCBXRbILz-P50dxii9v2fdA5VEu5QiKcWARFme9m0ERA8A9spg__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w1080": "https://cdn.movieofthenight.com/show/82/poster/horizontal/en/1080.jpg?Expires=1769129517&Signature=LlgeWdnVuxjqw0ddTqu8D3GYoFb5YoavPJYAxUfIbG~UqMSioySg7fTxkgbAEpeooKWpCyN6plTKL~8OlzWF9D5UvdzxizS5hrJO9k6YgjX0Barkb1QHIldMmulO-0UcT4NI77T7040ej5QWLwftfcAWctGqVDOtdtdgzBkTvQJW504r-I0UtTgGBiiYckQmWdBqSfzoXi44lpKbR0tEhU-D4IsLRLAUe-aBMkv9XiGYDfTD9KF031fu63aKRn42k1SMV6mzBIKUuXFyfsYBAc-87BhLhjR~HTECf-7Sfi1MSIGAGJm8hSsVI7y~MsGS1mYcqxGQRECybXZ3IASI~A__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w1440": "https://cdn.movieofthenight.com/show/82/poster/horizontal/en/1440.jpg?Expires=1769129517&Signature=FLlDUcQklSQCM5MKOyJkGTb7pL6yGn8jN2cA9pWcXIxOSxpQtflkQ05bMRn~covsLnjjwlRSnMF8fjIsxdkfaPElmKmutdo2CkKBgmeyUpAj3zsXWjwyc6x~O3kXmxB~ty70J4afZtyjTh4KfoEAtVDGvpfbPbPnKttEXv6UFPfwXqiW6X98i9t89wOcXKV2MmtehgmDCFo2rb0e2lPqo026z7hyPMLyNuLXTQGhWqhhI5Sic7Q4F7nltL7GCqNL5vAYYZyju9rSeNCZN4XeVAKcpJZCkxEIwgX-H-TmxFZ1tuu18KCI8VF0G5S5OOTRQS08jeGm7JE7UDIjsWpfWw__&Key-Pair-Id=KK4HN3OO4AT5R"
        },
        "verticalBackdrop": {
            "w240": "https://cdn.movieofthenight.com/show/82/backdrop/vertical/240.jpg?Expires=1769129502&Signature=OlzOPbGD-xVQEOqLhwBUzMjDVb~S-FpGROD8pTBo0wbzFVDjKvCuy-n9fBxDWWFVo3aDpfLaDcTQK3UYWBvVCSgd0Jj~-8sARJQhT4yYW3773AWFNb6xNyQEj350snmDo4Ymll~uuj9lBY1F8dn9xW8rxfKCQmoU88Wy8XgREbZh6SF7r-ZsvKxs0Dy0VvlQVhbHeSgvMX0cjbDeZ4JVMmLt5YGQlyutCD2VuFUnR9c~YlAAQdK7vIGTmytdK0pyOPrQ-45GOTHDhOoHq-CW6eFs37omseSlJWtYLTMHSc2qoJtAfA3MXozWjEYr4HoCLBf9U-r0BVI0ZWUDJPlYBw__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w360": "https://cdn.movieofthenight.com/show/82/backdrop/vertical/360.jpg?Expires=1769129502&Signature=lmE7jC~zSLv3B~IvFRRdSSjlVHQ7yy1iOvlzMx9dc0vNXvJ8yNktifkd1SnM1ial6uwUGBhQT04wE--xMOXPq-YSg7VOg5RQkAK~GGYlTzT2hmBTG25M4JgqZ7amwrEvLnfEmNmc-W8WtByzmBjAW2KDKjEDh4cJzYcU2F7oun20VsYbKx1glI0FaOCy0AXpxdqOBpFlG8ePDuJMp8zcQTV48umsmHXidegoCNjU~xgwm3FPtznlTeOlmyuPLnpwRJfI8xpTnSdGsENxQFZQPYyv9XvSkXZtOLVqfJLvwDJ~UYK6EGGKzgERvIJv36fXjoWHe7oON3XC0JStpDi0rA__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w480": "https://cdn.movieofthenight.com/show/82/backdrop/vertical/480.jpg?Expires=1769129502&Signature=NDyK4D6hmzPC-MNL~y2LodE2RN6ZgR8JjJ9wC9Hx1CepsTDGXuwRHwei3u9OJfca4UnbqFApKS9s9rwmmQvFoWLYfN~npF0qZZbYU0WE0yR~NlVtWpTpZJz-FM7En616lypq8SKma4sL6gnNt6FwpjD8cEallR6APD0t3VHeQlCd9QIwWiPud-E9CgLx9ZXBiPjZyuvFmdJZZERWBFkmmm8dFs6tOWZ0iizVhfvx~ha9QYXHqHchHLgV4BZ9EwryjfIhRCXvk3ss1SgYYWhy5u957bVxq~vnOngzpv3fOF5kZ3dmB5uAMfL97FvHphCV0IWJUC2MW6vuQjgsuiXQEw__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w600": "https://cdn.movieofthenight.com/show/82/backdrop/vertical/600.jpg?Expires=1769129502&Signature=dEe580IwDhNdhag~UYFsTxVUeHHR8rJYTQrzdrXj0H8qB1S0YIi8adMxbgW7iTrtWwRM-gtzLBwLLMThQHaWPrKw4KDXhV57fjRPAbFmZNGtmKxsv0foSowuaXarX2OmZ7yGoHkHV16SCbosK5qsh04Xk~EW8q8p9Qj0QUyYojhikrazojmWwiWgNFpVuD9cITLA76sjReJ7PXYZgyqFmRVV2S9zUCiBbnkPuhzuNapI5Hi8-vJY9UIK6KqEvA1bjjOFoyXlXbW-syb9jE5vfZzOSE3GkcDCnhGlCXsXzNb32z1HZcKNZ3XMFlD1Bab1HKTnTqA4xOLZwBShQZhOHw__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w720": "https://cdn.movieofthenight.com/show/82/backdrop/vertical/720.jpg?Expires=1769129502&Signature=S4NrZT~l2vZjx5Yv6DWqbZVQUZKdtSk-U1inxAiqVKGX5x9GKz4o8XlDR33ntmzzCkOckY2yi5piDuN8xaeHPekgH9oUCJqg2XpzVoZxFdzejoYxWjYvETM8tCpp5bACDcX6CAlq-hYv-wZD6wEXiRHwMtWszehJLMN1ITzsG9vJeQr35wXT6-fJ0fwKvAIT5~wc7DfkJi6ub2CC661W5XTObid9UVtCWJlnNZme458vyoKXquu14nRo9Hy72COZKl83Umg8Jd9UoBqK3KCgePn9VooifpuMbS0KGu325y2Vp~z1smm8Au2vjnp-JVksXYK3kIO7HTI0Bo6ZHLiVdA__&Key-Pair-Id=KK4HN3OO4AT5R"
        },
        "horizontalBackdrop": {
            "w360": "https://cdn.movieofthenight.com/show/82/backdrop/horizontal/360.jpg?Expires=1769129506&Signature=Uccf0PJ~Ie~gMNfkNW9Rjxgo6lTDulI0M~F~DclZ40--XXK9OurpZPetG7PeGDFIafqV29iJkzMzqxwiZT8ZBFLRZUvkhYTkMz70eoHcjAgV8ZsZp~BvdEGX1~nXgsCkPIU8qQ~uF5yHb01bLXFgJDgkRH8rRAfkciQJa~7VaShEt80UhTCC6BVmleQc1RNkKAPyq5uQEwRhl6gLckoShx1yCYKvohOaJ-UsQ3iE-Mve3A4-BbqACGe5CbM8hUMA1bPiNUKDcPH2zuPTQq~~cANMqkXGrQZkeYtYo9qL-Uo1dnWtKLIkLjQGNfQeazksqWt8WtAcaAMs4uInccHfvQ__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w480": "https://cdn.movieofthenight.com/show/82/backdrop/horizontal/480.jpg?Expires=1769129506&Signature=BGrIXC7Fm7Yg7AWUOlxrvw8mPt4~eZr6N0fnX8umLdhR-SHc3u8ecwfWnyIAPI0s1mXealiD3ni3X1QCInA8b-cCPDxp2wtNvyElPGmw~c50Bg0f6-HapGbQujBn4JF3o3UBl8iwqbCNf7BQgoQsYvg6eIyLKf4MSX5TlRf-fs0oRz5eEgCcoI7dd-3KWTp2tAUBMZJDOSjJWp383g1r0a39-ps98EQWQEgr96u-VAWpiiBGBuku9d8aNPGVjIf41q6onTfRiXTbnqB2fw50kx8EAXj0aHulgV5vsO1xMH0KJr7PqGi6JkrpzAi9W432C0xdxZyelyzJ4rOROzPZ4w__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w720": "https://cdn.movieofthenight.com/show/82/backdrop/horizontal/720.jpg?Expires=1769129506&Signature=i3uSVKdYHK35N0hsYuZyFHrVVxG5FZXFG34VwQf06MS11XqgGf0vyzM9wBLpc9mBU8qmfTcKFoEhGlDNgy1tbThuZK-k~iKsaXOOxMCf6om5uRRsqDz6NBpOdbvP9-4Y6rKtYM1F9-1xuPiPnukdiWAjGWJLZg16FZtFaXmn0qxVS6WMTfH9dDkJqwXGMjfuGPm2ZrjdFg7h4ZpJHdLMLZV~8OaxXJFwLbxSVQx66rbZuJUmkZyCmiJSpMUiL5O1t0B1MfKo~wk6h-bUJ4ivnfm3xVVjv-PjqBaJflfDHYQJyU0OP82DJNqpHCKpqDd31kG26e~wTCwMX4vNI30T8A__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w1080": "https://cdn.movieofthenight.com/show/82/backdrop/horizontal/1080.jpg?Expires=1769129506&Signature=irFpuTEbecSa1HQozgifMXa8Qs7aELQ2InQoxyRxmnbUCoFqLjThc9m2VAp4nfLY081nFVNvesEW3THaUEXDO4RCJRPfqqtu6~BlLRc~DXBp~okwRKxPvu5eJmF1c3XvabpQmCwCsAOB86PqIe2EfHzPWvC7F7fyHGtdxouO7-uULbJlljMNR377sAfqLiV43PqxzFSEdR6fp8GCKxMvLlN2HPFzYhyqhOks7jA-ihU0Rxp2O-lqVuqPxYtFbIufNrMNJxipd~tu6CG7a9E5R5tt999bzgNXpIgdtBj6Z2WGE5dZk0Ccoby2pK5NbHf8TO9Pz5i0ODNS2AEJ0Stbkg__&Key-Pair-Id=KK4HN3OO4AT5R",
            "w1440": "https://cdn.movieofthenight.com/show/82/backdrop/horizontal/1440.jpg?Expires=1769129506&Signature=QWV64zLACrrLMxApxfoaoM6d93yeDXbMT49CvfZjbDz4cSN~wnDoMpe5OUTvMPb7EFzO~SO2E62yMVd9u1pqr59R-cLu3Ct0WxNvHNBs0g-c3BM722FSvIjOsOtR~NlM0OeVuTSj4HwvCVy0J2qYPYlYdi5lW5HPQD2jzPJEobuersJNkhBegnYIDW9BmrgngSTYWYHf6NVTSXLXHu7wzebBuTDGnFm2fbIAunXSuf~56X6iiV2h-DzUYVHJJSc3J~3w0kfwNo094Wl5urR84uWDEi~o2QEaOExHMbux~cg9Wge3Qfc0M01WxRmzV8MBBNnkFIt9Wpph4RwR5lX2~g__&Key-Pair-Id=KK4HN3OO4AT5R"
        }
    },
    "streamingOptions": {
        "fi": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ara"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "fin"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "swe"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1736601768
            }
        ],
        "ae": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "hin"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ara"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "hin"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1735602645
            }
        ],
        "cz": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    },
                    {
                        "language": "pol"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ces"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "pol"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1726848782
            }
        ],
        "si": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    },
                    {
                        "language": "ita"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "hrv"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "hun"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ita"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1721707895
            }
        ],
        "pl": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    },
                    {
                        "language": "pol"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "pol"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1727043204
            }
        ],
        "md": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ron"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1670729202
            }
        ],
        "ua": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "audios": [],
                "subtitles": [],
                "expiresSoon": false,
                "availableSince": 1685669942
            }
        ],
        "co": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng",
                        "region": "USA"
                    },
                    {
                        "language": "por",
                        "region": "BRA"
                    },
                    {
                        "language": "spa",
                        "region": "MEX"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "por",
                            "region": "BRA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "MEX"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1745730000,
                "availableSince": 1727490600
            }
        ],
        "us": [
            {
                "service": {
                    "id": "plutotv",
                    "name": "Pluto TV",
                    "homePage": "https://pluto.tv/",
                    "themeColorCode": "#fff200",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/plutotv/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/plutotv/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/plutotv/logo-white.svg"
                    }
                },
                "type": "free",
                "link": "https://pluto.tv/gsa/on-demand/movies/6137ee7dc79f030013e056d0/details",
                "videoLink": "https://pluto.tv/gsa/on-demand/movies/6137ee7dc79f030013e056d0",
                "audios": [],
                "subtitles": [],
                "expiresSoon": false,
                "availableSince": 1743545406
            }
        ],
        "br": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    },
                    {
                        "language": "fra"
                    },
                    {
                        "language": "ita"
                    },
                    {
                        "language": "por",
                        "region": "BRA"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "fra"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ita"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "por",
                            "region": "BRA"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1744772399,
                "availableSince": 1721651554
            }
        ],
        "pt": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "fra"
                    },
                    {
                        "language": "por",
                        "region": "BRA"
                    },
                    {
                        "language": "spa",
                        "region": "ESP"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "fra"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "por"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "ESP"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1739603311
            }
        ],
        "au": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng",
                        "region": "USA"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    }
                ],
                "expiresSoon": false,
                "expiresOn": 1771304400,
                "availableSince": 1723074707
            },
            {
                "service": {
                    "id": "stan",
                    "name": "Stan",
                    "homePage": "https://www.stan.com.au/",
                    "themeColorCode": "#0072fb",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/stan/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/stan/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/stan/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.stan.com.au/watch/the-godfather-1972",
                "quality": "uhd",
                "audios": [],
                "subtitles": [
                    {
                        "closedCaptions": true,
                        "locale": {
                            "language": "eng"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1650043400
            }
        ],
        "ar": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng",
                        "region": "USA"
                    },
                    {
                        "language": "por",
                        "region": "BRA"
                    },
                    {
                        "language": "spa",
                        "region": "MEX"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "por",
                            "region": "BRA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "MEX"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1745730000,
                "availableSince": 1727495701
            },
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    },
                    {
                        "language": "ita"
                    },
                    {
                        "language": "spa"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ara"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ita"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1744772399,
                "availableSince": 1726721382
            }
        ],
        "cl": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng",
                        "region": "USA"
                    },
                    {
                        "language": "por",
                        "region": "BRA"
                    },
                    {
                        "language": "spa",
                        "region": "MEX"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "por",
                            "region": "BRA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "MEX"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1745730000,
                "availableSince": 1727489930
            }
        ],
        "rs": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "hrv"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "hun"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ron"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1727205185
            }
        ],
        "bg": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    },
                    {
                        "language": "tur"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "tur"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1727181554
            }
        ],
        "es": [
            {
                "service": {
                    "id": "prime",
                    "name": "Prime Video",
                    "homePage": "https://www.primevideo.com/",
                    "themeColorCode": "#00A8E1",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/logo-white.svg"
                    }
                },
                "type": "addon",
                "addon": {
                    "id": "maxes",
                    "name": "Max",
                    "homePage": "https://www.primevideo.com/storefront?benefitId=maxes",
                    "themeColorCode": "#000000",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/es/addons/maxes/light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/es/addons/maxes/dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/es/addons/maxes/white.svg"
                    }
                },
                "link": "https://www.primevideo.com/detail/0S9AH0G2U5J9VI90IAV3W3SR3E/ref=atv_dp",
                "quality": "sd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "spa"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1728079987
            },
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    },
                    {
                        "language": "fra"
                    },
                    {
                        "language": "ita"
                    },
                    {
                        "language": "por",
                        "region": "BRA"
                    },
                    {
                        "language": "spa",
                        "region": "ESP"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ara"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "fra"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ita"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ron"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "ESP"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1726849815
            }
        ],
        "pa": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "spa"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "zho"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1717749401
            },
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng",
                        "region": "USA"
                    },
                    {
                        "language": "por",
                        "region": "BRA"
                    },
                    {
                        "language": "spa",
                        "region": "MEX"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "por",
                            "region": "BRA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "MEX"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1745730000,
                "availableSince": 1727491433
            },
            {
                "service": {
                    "id": "disney",
                    "name": "Disney+",
                    "homePage": "https://www.disneyplus.com/",
                    "themeColorCode": "#01137c",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/disney/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/disney/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/disney/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.disneyplus.com/browse/entity-650bd6ee-a49b-4ac8-bd61-741ab67d188b",
                "videoLink": "https://www.disneyplus.com/play/650bd6ee-a49b-4ac8-bd61-741ab67d188b",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "spa",
                        "region": "419"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "419"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1731858043
            }
        ],
        "it": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng",
                        "region": "USA"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    }
                ],
                "expiresSoon": false,
                "expiresOn": 1777266000,
                "availableSince": 1723068316
            },
            {
                "service": {
                    "id": "now",
                    "name": "Now",
                    "homePage": "https://www.nowtv.it",
                    "themeColorCode": "#00818a",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/now/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/now/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/now/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.nowtv.it/watch/il-padrino-1972/R_192134_HD",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "ita"
                    },
                    {
                        "language": "ori"
                    }
                ],
                "subtitles": [],
                "expiresSoon": false,
                "expiresOn": 1753999199,
                "availableSince": 1723151754
            }
        ],
        "ie": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng",
                        "region": "USA"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    }
                ],
                "expiresSoon": false,
                "expiresOn": 1777266000,
                "availableSince": 1723068472
            },
            {
                "service": {
                    "id": "now",
                    "name": "Now",
                    "homePage": "https://www.nowtv.com/ie",
                    "themeColorCode": "#00818a",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/now/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/now/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/now/logo-white.svg"
                    }
                },
                "type": "addon",
                "addon": {
                    "id": "movies",
                    "name": "Cinema",
                    "homePage": "https://www.nowtv.com/ie/watch-movies-online",
                    "themeColorCode": "#ffffff",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/now/ie/addons/movies/light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/now/ie/addons/movies/dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/now/ie/addons/movies/white.svg"
                    }
                },
                "link": "https://www.nowtv.com/ie/online/the-godfather-1972/A5EK6sKrAaydU7UjrzQtJ",
                "audios": [
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [],
                "expiresSoon": false,
                "expiresOn": 1772323199,
                "availableSince": 1740872704
            }
        ],
        "mx": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    },
                    {
                        "language": "fra"
                    },
                    {
                        "language": "ita"
                    },
                    {
                        "language": "spa"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ara"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ell"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1744783199,
                "availableSince": 1717744598
            },
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng",
                        "region": "USA"
                    },
                    {
                        "language": "por",
                        "region": "BRA"
                    },
                    {
                        "language": "spa",
                        "region": "MEX"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "por",
                            "region": "BRA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "MEX"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1745730000,
                "availableSince": 1727459855
            }
        ],
        "ch": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng",
                        "region": "USA"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    }
                ],
                "expiresSoon": false,
                "expiresOn": 1777266000,
                "availableSince": 1723064667
            }
        ],
        "hk": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "jpn"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "zho"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1721658492
            }
        ],
        "tr": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "tur"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ara"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ell"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "tur"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1670729202
            }
        ],
        "ro": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    },
                    {
                        "language": "fra"
                    },
                    {
                        "language": "pol"
                    },
                    {
                        "language": "spa",
                        "region": "ESP"
                    },
                    {
                        "language": "tur"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "fra"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "hun"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ron"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "ESP"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1721939572
            }
        ],
        "fr": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng",
                        "region": "USA"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    }
                ],
                "expiresSoon": false,
                "expiresOn": 1777266000,
                "availableSince": 1723065800
            }
        ],
        "il": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "pol"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ara"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "heb"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "pol"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ron"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1670729202
            }
        ],
        "gb": [
            {
                "service": {
                    "id": "prime",
                    "name": "Prime Video",
                    "homePage": "https://www.amazon.co.uk/gp/video/storefront/",
                    "themeColorCode": "#00A8E1",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/logo-white.svg"
                    }
                },
                "type": "buy",
                "link": "https://www.amazon.co.uk/gp/video/detail/B00FZCAJ3Q/ref=atv_dp",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": true,
                        "locale": {
                            "language": "eng"
                        }
                    }
                ],
                "price": {
                    "amount": "3.99",
                    "currency": "GBP",
                    "formatted": "3.99 GBP"
                },
                "expiresSoon": false,
                "availableSince": 1691021144
            },
            {
                "service": {
                    "id": "prime",
                    "name": "Prime Video",
                    "homePage": "https://www.amazon.co.uk/gp/video/storefront/",
                    "themeColorCode": "#00A8E1",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/logo-white.svg"
                    }
                },
                "type": "rent",
                "link": "https://www.amazon.co.uk/gp/video/detail/B00FZCAJ3Q/ref=atv_dp",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": true,
                        "locale": {
                            "language": "eng"
                        }
                    }
                ],
                "price": {
                    "amount": "3.49",
                    "currency": "GBP",
                    "formatted": "3.49 GBP"
                },
                "expiresSoon": false,
                "availableSince": 1691021144
            },
            {
                "service": {
                    "id": "now",
                    "name": "Now",
                    "homePage": "https://www.nowtv.com",
                    "themeColorCode": "#00818a",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/now/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/now/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/now/logo-white.svg"
                    }
                },
                "type": "addon",
                "addon": {
                    "id": "movies",
                    "name": "Cinema",
                    "homePage": "https://www.nowtv.com/gb/watch/movies/highlights",
                    "themeColorCode": "#ffffff",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/now/gb/addons/movies/light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/now/gb/addons/movies/dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/now/gb/addons/movies/white.svg"
                    }
                },
                "link": "https://www.nowtv.com/watch/the-godfather-1972/A5EK6sKrAaydU7UjrzQtJ",
                "audios": [
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [],
                "expiresSoon": false,
                "expiresOn": 1772323199,
                "availableSince": 1740872652
            },
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng",
                        "region": "USA"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    }
                ],
                "expiresSoon": false,
                "expiresOn": 1777266000,
                "availableSince": 1723068858
            }
        ],
        "de": [
            {
                "service": {
                    "id": "prime",
                    "name": "Prime Video",
                    "homePage": "https://www.amazon.de/gp/video/storefront/",
                    "themeColorCode": "#00A8E1",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/logo-white.svg"
                    }
                },
                "type": "buy",
                "link": "https://www.amazon.de/gp/video/detail/B00FYV674S/ref=atv_dp",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": true,
                        "locale": {
                            "language": "eng"
                        }
                    }
                ],
                "price": {
                    "amount": "5.99",
                    "currency": "EUR",
                    "formatted": "5.99 EUR"
                },
                "expiresSoon": false,
                "availableSince": 1690362340
            },
            {
                "service": {
                    "id": "prime",
                    "name": "Prime Video",
                    "homePage": "https://www.amazon.de/gp/video/storefront/",
                    "themeColorCode": "#00A8E1",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/logo-white.svg"
                    }
                },
                "type": "addon",
                "addon": {
                    "id": "paramountplusde",
                    "name": "Paramount+",
                    "homePage": "https://www.amazon.de/gp/video/storefront?benefitId=paramountplusde",
                    "themeColorCode": "#000000",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/de/addons/paramountplusde/light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/de/addons/paramountplusde/dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/de/addons/paramountplusde/white.svg"
                    }
                },
                "link": "https://www.amazon.de/gp/video/detail/B00FYV674S/ref=atv_dp",
                "quality": "sd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": true,
                        "locale": {
                            "language": "eng"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1690362340
            },
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng",
                        "region": "USA"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    }
                ],
                "expiresSoon": false,
                "expiresOn": 1777266000,
                "availableSince": 1723069298
            },
            {
                "service": {
                    "id": "prime",
                    "name": "Prime Video",
                    "homePage": "https://www.amazon.de/gp/video/storefront/",
                    "themeColorCode": "#00A8E1",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/logo-white.svg"
                    }
                },
                "type": "rent",
                "link": "https://www.amazon.de/gp/video/detail/B00FYV674S/ref=atv_dp",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": true,
                        "locale": {
                            "language": "eng"
                        }
                    }
                ],
                "price": {
                    "amount": "3.99",
                    "currency": "EUR",
                    "formatted": "3.99 EUR"
                },
                "expiresSoon": false,
                "availableSince": 1690362340
            }
        ],
        "hr": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "ita"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "hrv"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "ita"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1727130678
            }
        ],
        "ec": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng",
                        "region": "USA"
                    },
                    {
                        "language": "por",
                        "region": "BRA"
                    },
                    {
                        "language": "spa",
                        "region": "MEX"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "por",
                            "region": "BRA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "MEX"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1745730000,
                "availableSince": 1727482872
            },
            {
                "service": {
                    "id": "disney",
                    "name": "Disney+",
                    "homePage": "https://www.disneyplus.com/",
                    "themeColorCode": "#01137c",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/disney/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/disney/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/disney/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.disneyplus.com/browse/entity-650bd6ee-a49b-4ac8-bd61-741ab67d188b",
                "videoLink": "https://www.disneyplus.com/play/650bd6ee-a49b-4ac8-bd61-741ab67d188b",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "spa",
                        "region": "419"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "419"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1731663565
            }
        ],
        "th": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "jpn"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "tha"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "zho"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1727027928
            }
        ],
        "pe": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng",
                        "region": "USA"
                    },
                    {
                        "language": "por",
                        "region": "BRA"
                    },
                    {
                        "language": "spa",
                        "region": "MEX"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "por",
                            "region": "BRA"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "MEX"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1745730000,
                "availableSince": 1727507019
            },
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "spa"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa"
                        }
                    }
                ],
                "expiresSoon": true,
                "expiresOn": 1744779599,
                "availableSince": 1726977211
            },
            {
                "service": {
                    "id": "disney",
                    "name": "Disney+",
                    "homePage": "https://www.disneyplus.com/",
                    "themeColorCode": "#01137c",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/disney/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/disney/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/disney/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.disneyplus.com/browse/entity-650bd6ee-a49b-4ac8-bd61-741ab67d188b",
                "videoLink": "https://www.disneyplus.com/play/650bd6ee-a49b-4ac8-bd61-741ab67d188b",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "spa",
                        "region": "419"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa",
                            "region": "419"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1731911044
            }
        ],
        "dk": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "dan"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "swe"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1717752767
            }
        ],
        "vn": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "jpn"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "vie"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "zho"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1735775954
            }
        ],
        "is": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "dan"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "isl"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1714750326
            }
        ],
        "kr": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "jpn"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "kor"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1726882758
            }
        ],
        "sg": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "jpn"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "msa"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "zho"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1727082470
            }
        ],
        "za": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "hin"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "hin"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1670729202
            }
        ],
        "ca": [
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "eng",
                        "region": "USA"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    }
                ],
                "expiresSoon": false,
                "expiresOn": 1771304400,
                "availableSince": 1723065943
            }
        ],
        "at": [
            {
                "service": {
                    "id": "prime",
                    "name": "Prime Video",
                    "homePage": "https://www.amazon.de/gp/video/storefront/",
                    "themeColorCode": "#00A8E1",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/logo-white.svg"
                    }
                },
                "type": "addon",
                "addon": {
                    "id": "paramountplusde",
                    "name": "Paramount+",
                    "homePage": "https://www.amazon.de/gp/video/storefront?benefitId=paramountplusde",
                    "themeColorCode": "#000000",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/at/addons/paramountplusde/light-theme.png",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/at/addons/paramountplusde/dark-theme.png",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/at/addons/paramountplusde/white.svg"
                    }
                },
                "link": "https://www.amazon.de/gp/video/detail/B00FYV674S/ref=atv_dp",
                "quality": "sd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": true,
                        "locale": {
                            "language": "eng"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1689778225
            },
            {
                "service": {
                    "id": "paramount",
                    "name": "Paramount+",
                    "homePage": "https://www.paramountplus.com/",
                    "themeColorCode": "#0064FF",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/paramount/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/paramount/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/paramount/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.paramountplus.com/movies/video/gUufhVPlJy5i5HLTbS8li1LruEeMH_3x/",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng",
                        "region": "USA"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng",
                            "region": "USA"
                        }
                    }
                ],
                "expiresSoon": false,
                "expiresOn": 1777266000,
                "availableSince": 1723064296
            },
            {
                "service": {
                    "id": "prime",
                    "name": "Prime Video",
                    "homePage": "https://www.amazon.de/gp/video/storefront/",
                    "themeColorCode": "#00A8E1",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/logo-white.svg"
                    }
                },
                "type": "rent",
                "link": "https://www.amazon.de/gp/video/detail/B00FYV674S/ref=atv_dp",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": true,
                        "locale": {
                            "language": "eng"
                        }
                    }
                ],
                "price": {
                    "amount": "3.99",
                    "currency": "EUR",
                    "formatted": "3.99 EUR"
                },
                "expiresSoon": false,
                "availableSince": 1689778225
            },
            {
                "service": {
                    "id": "prime",
                    "name": "Prime Video",
                    "homePage": "https://www.amazon.de/gp/video/storefront/",
                    "themeColorCode": "#00A8E1",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/prime/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/prime/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/prime/logo-white.svg"
                    }
                },
                "type": "buy",
                "link": "https://www.amazon.de/gp/video/detail/B00FYV674S/ref=atv_dp",
                "quality": "hd",
                "audios": [
                    {
                        "language": "deu"
                    },
                    {
                        "language": "eng"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "deu"
                        }
                    },
                    {
                        "closedCaptions": true,
                        "locale": {
                            "language": "eng"
                        }
                    }
                ],
                "price": {
                    "amount": "5.99",
                    "currency": "EUR",
                    "formatted": "5.99 EUR"
                },
                "expiresSoon": false,
                "availableSince": 1689778225
            }
        ],
        "ph": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "jpn"
                    },
                    {
                        "language": "spa"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "spa"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "zho"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1717748681
            }
        ],
        "mk": [
            {
                "service": {
                    "id": "netflix",
                    "name": "Netflix",
                    "homePage": "https://www.netflix.com/",
                    "themeColorCode": "#E50914",
                    "imageSet": {
                        "lightThemeImage": "https://media.movieofthenight.com/services/netflix/logo-light-theme.svg",
                        "darkThemeImage": "https://media.movieofthenight.com/services/netflix/logo-dark-theme.svg",
                        "whiteImage": "https://media.movieofthenight.com/services/netflix/logo-white.svg"
                    }
                },
                "type": "subscription",
                "link": "https://www.netflix.com/title/60011152/",
                "videoLink": "https://www.netflix.com/watch/60011152",
                "quality": "uhd",
                "audios": [
                    {
                        "language": "eng"
                    },
                    {
                        "language": "tur"
                    }
                ],
                "subtitles": [
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "eng"
                        }
                    },
                    {
                        "closedCaptions": false,
                        "locale": {
                            "language": "tur"
                        }
                    }
                ],
                "expiresSoon": false,
                "availableSince": 1670729202
            }
        ]
    }
}
*/


/*
let dummydata  = {
    "titles": [
        {
            "titleId": "tt0468569",
            "titleName": "The Dark Knight",
            "streamingOptions": [
                {
                    "country": "de",
                    "services": [
                        {
                            "name": "Netflix",
                            "link": "https://www.netflix.com/title/70079583/",
                            "type": "subscription"
                        }
                    ]
                },
                {
                    "country": "us",
                    "services": [
                        {
                            "name": "Max",
                            "link": "https://play.max.com/movie/52217243-a137-45d6-9c6a-0dfab4633034",
                            "type": "subscription"
                        },
                        {
                            "name": "Netflix",
                            "link": "https://www.netflix.com/title/70079583/",
                            "type": "subscription"
                        }
                    ]
                }
            ]
        },
        {
            "titleId": "tt0111161",
            "titleName": "The Shawshank Redemption",
            "streamingOptions": []
        },
        {
            "titleId": "tt0167260",
            "titleName": "The Lord of the Rings: The Return of the King",
            "streamingOptions": [
                {
                    "country": "de",
                    "services": [
                        {
                            "name": "Prime Video",
                            "link": "https://www.amazon.de/gp/video/detail/B00EXIU708/ref=atv_dp",
                            "type": "subscription"
                        }
                    ]
                },
                {
                    "country": "us",
                    "services": [
                        {
                            "name": "Max",
                            "link": "https://play.max.com/movie/ad704585-6774-4d37-8c61-1bd41154173f",
                            "type": "subscription"
                        },
                        {
                            "name": "Max",
                            "link": "https://play.max.com/movie/138a65ad-be35-4554-b57f-60d38c7ff0f0",
                            "type": "subscription"
                        }
                    ]
                }
            ]
        },
        {
            "titleId": "tt1375666",
            "titleName": "Inception",
            "streamingOptions": [
                {
                    "country": "de",
                    "services": [
                        {
                            "name": "Netflix",
                            "link": "https://www.netflix.com/title/70131314/",
                            "type": "subscription"
                        },
                        {
                            "name": "Prime Video",
                            "link": "https://www.amazon.de/gp/video/detail/B0B5K76N87/ref=atv_dp",
                            "type": "subscription"
                        }
                    ]
                },
                {
                    "country": "us",
                    "services": [
                        {
                            "name": "Netflix",
                            "link": "https://www.netflix.com/title/70131314/",
                            "type": "subscription"
                        },
                        {
                            "name": "Apple TV",
                            "link": "https://tv.apple.com/us/movie/inception/umc.cmc.6loas01ow0w4lkatxxloz7a6e?playableId=tvs.sbd.4000%3AA0173517001",
                            "type": "subscription"
                        }
                    ]
                }
            ]
        }
    ]
}
*/


