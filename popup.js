const button = document.getElementById("button");
const errorElement = document.getElementById("error");
const serviceCheckboxes = document.querySelectorAll('.service-checkbox');


button.onclick = async () => {
    const activeTab = await getCurrentTab();
    if(!isValidPage(activeTab)){
        return;
    }

    saveServiceSelection();

    const selectedServices = getSelectedServices();
    console.log(selectedServices);

    if (!isValidSelection(selectedServices)) {
        showError("Please select at least one streaming service.");
        return;
    } else {
        clearError();
    }

    //chrome.storage.local.set({serviceSelection: serviceArr});

    const prefs = {
        service: selectedServices,
        tabInfo: activeTab,
    }

    sendPrefsBasedOnButton(prefs);
    console.log("tabinfo.id" + prefs.tabInfo.id);

    button.textContent = "Get More";
}

function getSelectedServices() {
    return Array.from(serviceCheckboxes)
        .filter(checkbox => checkbox.checked)
        .map(checkbox => checkbox.id);
}

function isValidSelection(serviceArray) {
    return serviceArray.length > 0;
}

function showError(message) {
    errorElement.textContent = message;
}

function clearError() {
    errorElement.textContent = "";
}

function sendPrefsBasedOnButton(prefs) {
    const event = (button.textContent === "Get More") ? "getMore" : "sendingPrefs";
    console.log(`Sending event: ${event}`, prefs);
    chrome.runtime.sendMessage({ event, data: prefs });
}

async function getCurrentTab(){
    let queryOptions = { active: true, currentWindow: true};
    let [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}


document.addEventListener("DOMContentLoaded", async () => {
    const activeTab = await getCurrentTab();
    console.log(activeTab);

    if (validURL(activeTab.url)) {
        console.log("Valid page");
        chrome.storage.local.get(["loadedTitleCount", "lastPageUrl", "serviceSelection"], (result) => {
            const { loadedTitleCount = 0, lastPageUrl = "", serviceSelection = [] } = result;
            if (lastPageUrl === activeTab.url && loadedTitleCount > 0) {
                button.textContent = "Get More";
            } else {
                button.textContent = "Load movies/series";
                chrome.storage.local.set({
                    loadedTitleCount: 0,
                    lastPageUrl: activeTab.url
                    });
            }
            //console.log("serviceselection", serviceSelection);

            loadCheckboxes(serviceSelection);

        });
        errorElement.textContent = "";
    } else {
        console.log("Not a valid page");
        button.disabled = true;
        button.textContent = "Load movies/series";
        chrome.storage.local.set({ loadedTitleCount: 0, lastPageUrl: activeTab.url });
        errorElement.textContent = "Not a valid page";
    }

    // Add event listeners to save selections on change
    serviceCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', saveServiceSelection);
    });
});

const loadCheckboxes = (serviceSelection) => {
    //deactivate all checkboxes
    serviceCheckboxes.forEach(cb => cb.checked = false);

    //activate saved checkboxes
    serviceSelection.forEach(service => {
        const checkbox = document.getElementById(service);
        if (checkbox) {
            checkbox.checked = true;
        }
    });

    const defaultServices = ["netflix", "prime", "disney", "apple"];
    if (serviceSelection.length === 0) {
        defaultServices.forEach(service => {
        const checkbox = document.getElementById(service);
        if (checkbox) checkbox.checked = true;
        });
    }
}

const validURL = (url) => {
    return ( (url.includes("imdb.com/") && url.includes("chart/top")) || (url.includes("imdb.com/") && url.includes("/list/ls")) || 
        (url.includes("imdb.com/") &&  url.includes("/title/tt")) ||
        ( url.includes("imdb.com/") &&  url.includes("/user/") &&  ( url.includes("watchhistory") || url.includes("ratings") || url.includes("watchlist") ) ) ||
        ( url.includes("imdb.com/") && url.includes("chart/tvmeter/")) || (url.includes("imdb.com") && url.includes("chart/moviemeter") )  )
}

function isValidPage(activeTab){
    if(activeTab.url.includes("/title/tt")){
        button.disabled = true;
        console.log("title/tt");
        errorElement.textContent = "Loading";
        return false;
    }
    if(validURL(activeTab.url)){
        button.disabled = false;
        console.log("valid page")
        console.log(activeTab.url.includes("imdb.com/chart/top"))
        errorElement.textContent = "";
        return true;
    }else{
        button.disabled = true;
        errorElement.textContent = "not a valid page";
        console.log("not valid page");
        return false;
    }
}

//save the selected services to storage
const saveServiceSelection = () => {
    const serviceArr = Array.from(serviceCheckboxes)
        .filter(checkbox => checkbox.checked)
        .map(checkbox => checkbox.id);
    chrome.storage.local.set({serviceSelection: serviceArr});
    console.log("Saved service selection:", serviceArr);
    if(serviceArr.length) errorElement.textContent = "";
}
