import argparse
import ast
from datetime import UTC, date, datetime, timedelta
from getpass import getpass
from html import unescape
from http.cookiejar import CookieJar
import json
import os
import re
import string
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener
from uuid import uuid4


ORIGIN = "https://www.drawnames.pt"
SETUP = "/sorteio-amigo-secreto"
CASES = {
    "E1": (4, {letter: ("CD" if letter in "AB" else "AB") for letter in "ABCD"}),
    "E1b": (5, {letter: ("DE" if letter in "ABC" else "BC") for letter in "ABCDE"}),
    "E1c": (5, dict(zip("ABCDE", ("DE", "CE", "BD", "AB", "AC")))),
    "E2": (6, {letter: ("DEF" if letter in "ABC" else "ABC") for letter in "ABCDEF"}),
    "E2m": (6, dict(zip("ABCDEF", ("DEF", "DEF", "EF", "ABC", "ABC", "BC")))),
    "E3": (4, {}),
    "E4": (6, {}),
    "E4s": (6, {"A": "B"}),
    "E6": (4, {"A": "B"}),
    "two": (2, {}),
}
TEST_TITLE = re.compile(r"DrawNames research [0-9a-f]{8}")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


class DrawNames:
    def __init__(self):
        self.http = build_opener(NoRedirect(), HTTPCookieProcessor(CookieJar()))

    def request(self, path, payload=None, redirects=5, *, follow_invite=False):
        parts = urlsplit(path)
        if follow_invite and payload is None and parts.netloc == "drawnames.app" and parts.scheme == "https":
            if not re.fullmatch(r"/t/[A-Za-z0-9_-]+", parts.path):
                raise ValueError("Expected the official DrawNames invitation redirect")
            url = path
        else:
            url = ORIGIN + site_path(path)
        headers = {"User-Agent": "Mozilla/5.0"}
        body = None
        if payload is not None:
            headers.update({
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": ORIGIN,
                "Referer": ORIGIN + SETUP,
            })
            body = json.dumps(payload).encode()
        try:
            with self.http.open(Request(url, body, headers), timeout=20) as response:
                text = response.read().decode("utf-8")
                if payload is None:
                    return text
                return json.loads(text) if text.strip() else {}
        except HTTPError as error:
            if payload is None and redirects and error.code in {301, 302, 303, 307, 308}:
                location = error.headers.get("Location", "")
                return self.request(location, redirects=redirects - 1, follow_invite=follow_invite)
            raise ValueError(f"DrawNames returned HTTP {error.code} for the requested operation") from None


def site_path(url):
    parts = urlsplit(url)
    if parts.netloc and (parts.scheme != "https" or parts.netloc != "www.drawnames.pt"):
        raise ValueError("Expected a DrawNames Portugal link")
    if not parts.path.startswith("/") or parts.path.startswith("//"):
        raise ValueError("Expected a DrawNames Portugal path")
    return parts.path + ("?" + parts.query if parts.query else "")


def organizer_page(client, link, read_code):
    path = site_path(link)
    if not path.startswith("/sorteio-amigo-secreto/visao-geral/"):
        raise ValueError("Expected the test group's organizer overview link")
    html = client.request(path)
    config = page_json(html, "modelConfig")
    if not config.get("continueAsYourselfUrl"):
        return html
    if not TEST_TITLE.fullmatch(config.get("groupName", "")):
        raise ValueError("The link is not for a group created by the research tool")
    otp = config["otp"]
    started = datetime.now(UTC)
    requested = client.request(site_path(otp["requestByIdUrl"]), {})
    code = read_code(started)
    if not re.fullmatch(r"[0-9]{5}", code):
        raise ValueError("Expected five digits")
    client.request(site_path(otp["verifyUrl"] + quote(requested["publicProfileId"], safe="")), {"otp": code})
    return client.request(site_path(config["continueAsYourselfUrl"]))


def page_json(html, name):
    match = re.search(rf"\bvar\s+{name}\s*=\s*JSON\.parse\(('(?:[^'\\]|\\.)*')\)", html)
    if not match:
        raise ValueError(f"The setup page did not expose {name}")
    return json.loads(ast.literal_eval(match[1]))


def clean(value):
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()
                if item is not None and item is not False and item != "" and item != []}
    if isinstance(value, list):
        return [clean(item) for item in value]
    return value


def check(client, step, lottery):
    response = client.request("/lottery/" + step, clean(lottery))
    result = response.get("lottery")
    if not isinstance(result, dict):
        raise ValueError(f"{step} did not return the setup model")
    if result.get("hasError"):
        fields = sorted(key for key, value in result.items() if key.startswith("error") and value)
        detail = result.get("errorExcludes") if step == "checkexcludes" else None
        message = unescape(re.sub(r"<[^>]+>", "", detail)) if isinstance(detail, str) else ""
        raise ValueError(f"{step} rejected the setup ({', '.join(fields) or 'no error fields'})"
                         + (f" {message}" if message else ""))
    return response, result


def prepare(client, case):
    html = client.request(SETUP)
    lottery = page_json(html, "modelData")
    config = page_json(html, "modelConfig")
    size, excluded = CASES[case]
    participants = list(string.ascii_uppercase[:size])
    template = lottery["members"][0]
    lottery["members"] = [
        dict(template, name=f"Test {letter}", email=None, isNew=index > 0)
        for index, letter in enumerate(participants)
    ]
    response, lottery = check(client, "checknames", lottery)
    actual = [member for member in lottery["members"] if member.get("participatesInDraw")
              and member.get("name")]
    if [member["name"] for member in actual] != [f"Test {letter}" for letter in participants]:
        raise ValueError("The server did not preserve the requested roster and insertion order")

    cap = lottery["numMembers"] - config["minGroupSize"]
    print(f"{case}: roster accepted, minimum group for exclusions "
          f"{lottery['numMinExcludesMembers']}, selector cap {max(0, cap)} per giver",
          file=sys.stderr, flush=True)
    if excluded and (size < lottery["numMinExcludesMembers"] or
                     any(len(recipients) > cap for recipients in excluded.values())):
        raise ValueError("The public exclusion selector cannot enter this case")

    ids = dict(zip(participants, actual))
    choices = response.get("possibleExcludes") or {}
    lottery["excludesType"] = 2 if excluded else 3
    for giver, recipients in excluded.items():
        member = ids[giver]
        member["excludes"] = [
            dict(next((item for item in choices.get(member["id"], []) if item["id"] == ids[target]["id"]), {}),
                 id=ids[target]["id"], name=ids[target]["name"], checked=True, excludeType=1)
            for target in recipients
        ]
    lottery["timestamp"] = int(time.time() * 1000)
    _, lottery = check(client, "checkexcludes", lottery)
    expected = {f"Test {giver}": {f"Test {target}" for target in recipients}
                for giver, recipients in excluded.items()}
    names_by_id = {member["id"]: member["name"] for member in lottery["members"] if member.get("name")}
    returned = {member["name"]: {names_by_id[item["id"]] for item in member["excludes"]}
                for member in lottery["members"] if member.get("excludes")}
    if expected != returned:
        raise ValueError("The server returned a different exclusion set")
    print(f"{case}: exclusion check accepted {sum(map(len, expected.values()))} directed exclusions",
          file=sys.stderr, flush=True)
    return html, lottery


def create(client, html, lottery, email, event_date, read_code=None):
    title = f"DrawNames research {uuid4().hex[:8]}"
    lottery.update(groupName=title, eventId="0", eventDate=event_date, budget=0,
                   message="Fictional group for a probability experiment.")
    _, lottery = check(client, "checkgroupname", lottery)
    lottery["members"][0]["email"] = email
    for name in ("TransactionId", "TransactionTimecode"):
        match = re.search(rf'name="{name}"\s+value="([^"]+)"', html)
        if not match:
            raise ValueError("The setup page changed or omitted its transaction inputs")
        lottery[name[0].lower() + name[1:]] = match[1]
    print(f"Submitting fictional group {title}", file=sys.stderr, flush=True)
    started = datetime.now(UTC)
    result, lottery = check(client, "checkdetails", lottery)
    if lottery.get("continuationUrl"):
        print("Group creation succeeded in the signed-in organizer session.", file=sys.stderr)
        return lottery["continuationUrl"]
    timecode = lottery.get("publicTimecode")
    organizer_id = result.get("publicProfileId") or lottery.get("publicOrganiserId")
    if not timecode or not organizer_id:
        raise ValueError("Creation returned no organizer confirmation details")
    print("DrawNames accepted the creation request and requested organizer confirmation.",
          file=sys.stderr, flush=True)
    code = (read_code or prompt_code)(started).strip()
    if not re.fullmatch(r"[0-9]{5}", code):
        raise ValueError("Expected five digits")
    path = f"/api/lottery/verify-otp-and-confirm-lottery/{quote(timecode, safe='')}/{quote(organizer_id, safe='')}"
    confirmation = client.request(path, {"otp": code, "email": email})
    if not confirmation.get("continuationUrl"):
        raise ValueError("DrawNames did not confirm the group")
    print("Organizer confirmation succeeded.", file=sys.stderr)
    return confirmation["continuationUrl"]


def created_overview(client, link, read_code):
    html = client.request(site_path(link))
    config = page_json(html, "modelConfig")
    if config.get("invitationOptions") and config["urls"].get("GroupPage"):
        link = config["urls"]["GroupPage"]
        html = client.request(site_path(link))
        config = page_json(html, "modelConfig")
    if config.get("continueAsYourselfUrl"):
        return organizer_page(client, link, read_code)
    return html


def reveal(client, overview):
    group = page_json(overview, "modelConfig")
    if group["urls"].get("groupPage") and group.get("validLotteryContext"):
        group = page_json(client.request(site_path(group["urls"]["groupPage"])), "modelConfig")
    if not group.get("memberParticipatesInDraw"):
        raise ValueError("The active test role does not participate in the draw")
    result = page_json(client.request(site_path(group["urls"]["DetailsWishlist"])), "modelConfig")
    if not result.get("drawnBySelf") or not result.get("name"):
        raise ValueError("The active test role has no drawn recipient page")
    if not result["hasViewedDrawnName"]:
        viewed = client.request(site_path(result["urls"]["DrawViewed"]), {"name": result["name"]})
        if not viewed.get("success"):
            raise ValueError("The participant reveal was not confirmed")
    return result["name"]


def invite_link(client, group, create_link):
    invitations = page_json(client.request(site_path(group["urls"]["InvitationLottery"])), "modelConfig")
    option = next((item for item in invitations["invitationOptions"] if item["name"] == "Link do convite"), None)
    if not option:
        raise ValueError("The organizer page did not offer an invitation link")
    if create_link:
        client.request(site_path(invitations["urls"]["InvitationTypeSelected"] + "/" + option["code"]), {})
    share = page_json(client.request(site_path(option["url"])), "modelConfig")
    if not share.get("url"):
        raise ValueError("The service did not offer a share URL")
    return share["url"]


def register_guest(client, invite, name, address, read_code, title):
    started, registration = start_guest(client, invite, name, address, title)
    return finish_guest(client, *registration, read_code(started))


def start_guest(client, invite, name, address, title):
    join_page = client.request(invite, follow_invite=True)
    config = page_json(join_page, "modelConfig")
    if config["groupName"] != title or config["allowEnterName"]:
        raise ValueError("The invitation did not open the expected fixed-roster test group")
    member = next((item for item in config["members"] if item["name"] == name), None)
    if not member or member["hasEmail"]:
        raise ValueError(f"{name} is unavailable for first-time registration")
    endpoint = config["sendRegistrationConfirmationEmailUrl"].replace(
        "{lotteryId}", config["id"]).replace("{memberId}", member["publicId"])
    started = datetime.now(UTC)
    requested = client.request(site_path(endpoint), {"email": address, "memberId": member["publicId"]})
    return started, (join_page, config, member, address, requested)


def finish_guest(client, join_page, config, member, address, requested, code):
    code = code.strip()
    if not re.fullmatch(r"[0-9]{5}", code):
        raise ValueError("Expected five digits")
    verify = config["otp"]["verifyUrl"] + quote(requested["publicProfileId"], safe="")
    client.request(site_path(verify), {"otp": code, "email": address})
    data = page_json(join_page, "modelData")
    data.update(name=member["name"], email=address, joinId=member["joinId"])
    registered = client.request(site_path(config["urls"]["Register"]), data)
    if not registered.get("continuationUrl"):
        raise ValueError(f"{member['name']} registration did not finish")
    return client.request(site_path(registered["continuationUrl"]))


def master_list(client, group, overview, client_date):
    computed = page_json(overview, "modelLotteryComputed")
    if not group["organiserMode"] or not group["eventDatePassed"] or (
            computed["status"] != group["enums"]["lotteryStatus"]["Drawn"]):
        raise ValueError("The ordinary organizer view has not released the results")
    results = page_json(client.request(site_path(group["urls"]["MasterListLottery"])), "modelConfig")
    if not results.get("masterListViewDate"):
        results = client.request(site_path(results["urls"]["MasterListView"]),
                                 {"id": "overview", "autocomplete": "off", "clientDate": client_date})
    return {row["name"]: row["drawn"] for row in results["draws"].get("1", [])
            if row["drawViewed"] and row["drawn"]}


def collect(client, overview, case, email, client_date, read_code=None):
    group = page_json(overview, "modelConfig")
    lottery = page_json(overview, "modelLottery")
    title = lottery["groupName"]
    size, exclusions = CASES[case]
    labels = string.ascii_uppercase[:size]
    names = [f"Test {label}" for label in labels]
    if not (group["organiserMode"] and group["memberName"] == names[0] and
            TEST_TITLE.fullmatch(title) and
            [member["name"] for member in lottery["members"]] == names and
            lottery["multipleDraws"] == 1):
        raise ValueError("This is not the expected fictional organizer group")

    invite = invite_link(client, group, lottery["invitationType"] is None)
    observed = {names[0]: reveal(client, overview)}
    local, domain = email.rsplit("@", 1)
    trial = title.split()[-1]
    for label, name in zip(labels[1:], names[1:]):
        guest = DrawNames()
        alias = f"{local}+drawnames-{trial}-{label.lower()}@{domain}"
        print(f"Verifying {name} through an alias in the organizer inbox.", file=sys.stderr, flush=True)
        participant = register_guest(guest, invite, name, alias, read_code or prompt_code, title)
        observed[name] = reveal(guest, participant)
    if set(observed.values()) != set(names):
        raise ValueError("The revealed names are not a complete one-to-one assignment")
    assignments = {giver: observed[name].removeprefix("Test ") for giver, name in zip(labels, names)}
    if any(giver == recipient or recipient in exclusions.get(giver, "") for giver, recipient in assignments.items()):
        raise ValueError("The reported assignment violates this case's constraints")
    if group["eventDatePassed"] and master_list(client, group, overview, client_date) != observed:
        raise ValueError("The organizer results disagree with participant reveals")
    return {"trial": trial, "case": case, "assignments": assignments,
            "insertionOrder": list(labels), "revealOrder": list(labels)}


def prompt_code(_started):
    return getpass("Enter the five-digit DrawNames code: ").strip()


def main():
    parser = argparse.ArgumentParser(description="Probe the ordinary DrawNames Portugal setup workflow")
    parser.add_argument("action", choices=("probe", "create", "collect"))
    parser.add_argument("case", choices=CASES)
    parser.add_argument("--date", type=date.fromisoformat, default=date.today() + timedelta(days=1))
    parser.add_argument("--collect", action="store_true",
                        help="After creating, also follow the official invite and send guest OTPs to your Gmail aliases")
    args = parser.parse_args()
    if args.collect and args.action != "create":
        parser.error("--collect applies to create")
    try:
        email = None
        if args.action != "probe":
            email = os.environ.get("DRAWNAMES_RESEARCH_EMAIL") or getpass("Organizer email you control: ").strip()
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
                raise ValueError("Enter an organizer email address you control")
        if (args.collect or args.action == "collect") and email.rsplit("@", 1)[1].lower() != "gmail.com":
            raise ValueError("Collection uses plus aliases in your Gmail inbox")
        client = DrawNames()
        if args.action == "collect":
            link = getpass("Organizer overview link from this test group's email: ").strip()
            overview = organizer_page(client, link, prompt_code)
            print(json.dumps(collect(client, overview, args.case, email, date.today().isoformat())))
        else:
            html, lottery = prepare(client, args.case)
            if args.action == "create":
                link = create(client, html, lottery, email, args.date.isoformat())
                if args.collect:
                    overview = created_overview(client, link, prompt_code)
                    print(json.dumps(collect(client, overview, args.case, email, date.today().isoformat())))
    except (ValueError, URLError, TimeoutError, EOFError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
