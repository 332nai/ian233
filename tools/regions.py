# broad Sydney regions from the area text; anything unmatched takes the region of its nearest matched neighbour on the map
import re
REGIONS = [  # (region, patterns) checked in order, first match wins
 ('城南', r'Surry Hills|Redfern|Waterloo|Zetland|Rosebery|Mascot|Botany|Alexandria|Chippendale|Erskineville'),
 ('东区', r'Darlinghurst|Potts Point|Woolloomooloo|Paddington|Rushcutters|Kings Cross|Elizabeth Bay|Double Bay|Bondi|Watsons Bay|Moore Park|Entertainment Quarter|Randwick|Rose Bay|Coogee|Edgecliff'),
 ('内西', r'Glebe|Newtown|Enmore|Marrickville|Petersham|Dulwich|Balmain|Rozelle|Leichhardt|Annandale|Ashfield|Burwood|Strathfield|Homebush|Concord|Five Dock|Enfield|Croydon|Summer Hill|Haberfield|Wareemba|Rhodes|Stanmore|Drummoyne|Canada Bay|Abbotsford'),
 ('山区', r'Castle Hill|Castle Mall|Castle Tower|Norwest|Baulkham|Bella Vista|Cherrybrook|Glenhaven|Kellyville|Rouse Hill|Dural|West Pennant|Pennant Hills'),
 ('北区', r'Eastwood|Ryde|Macquarie|\bMQ\b|Epping|Carlingford|Melrose|Meadowbank|Putney|Gladesville|Telopea|Beecroft|Marsfield|Denistone|Ermington'),
 ('北岸', r'Northbridge|North Bridge|Chatswood|Crows Nest|North Sydney|St Leonards|Willoughby|Artarmon|Neutral Bay|Mosman|Kirribilli|Waverton|Lindfield|Roseville|Gordon|Pymble|St Ives|Wahroonga|Thornleigh|Hornsby|Lane Cove|McMahons|Milsons|Cammeray|Killara|Turramurra|Manly|Dee Why|Brookvale'),
 ('西区', r'Lidcombe|Auburn|Parramatta|Wentworth Point|Olympic|Silverwater|Mt Druitt|Mount Druitt|Merrylands|Granville|Blacktown|Westmead|Harris Park|Cabramatta|Fairfield|Bankstown|Liverpool(?! St)'),
 ('南区', r'Hurstville|Kogarah|Revesby|Miranda|Rockdale|Beverly Hills|Wolli Creek|Arncliffe|Sans Souci|Sutherland|Cronulla|Campsie|Canterbury|Belmore|Lakemba|Padstow'),
 ('市区', r'CBD|唐人街|市中心|中央车站|Haymarket|Chinatown|Darling|Barangaroo|Rocks|Quay|Ultimo|Pyrmont|Wynyard|Martin Pl|QVB|George St|Pitt St|Kent St|Sussex St|Clarence St|York St|King St|Dixon|Central|Broadway|Town Hall|Crown|Barrack|Hunter St|Bridge Lane|Bridge St|Elizabeth St|Castlereagh|Bathurst|Liverpool St|Sheraton|Hilton|Galeries|Wentworth Ave|Hyde Park|Star|Regent|Angel Pl|Grosvenor|Shangri|Macquarie St|Phillip St|Temperance|Market St|Park St|Sydney Fish Market|Fish Market|Capitol|World Square|MLC|UTS'),
]
NAMES = {'市区':'市区 CBD','城南':'城南 Inner South','东区':'东区 Eastern Suburbs','内西':'内西 Inner West','西区':'西区 West','北区':'北区 Ryde/Eastwood','北岸':'北岸 North Shore','山区':'山区 Hills','南区':'南区 South'}
def tag(D):
    for d in D:
        a=d.get('a','')
        main=re.split(r'[（(]',a)[0]  # the shop's own location, before notes like "Burwood也有"
        d['rg']=next((r for r,p in REGIONS if re.search(p,main,re.I)),None) or next((r for r,p in REGIONS if re.search(p,a,re.I)),None)
        # "Macquarie St" is in the city, not Macquarie Park
        if d['rg']=='北区' and re.search(r'Macquarie (St|Pl)',a): d['rg']='市区'
    have=[d for d in D if d['rg'] and d.get('xy')]
    for d in D:
        if not d['rg'] and d.get('xy'):
            n=min(have,key=lambda e:(e['xy'][0]-d['xy'][0])**2+(e['xy'][1]-d['xy'][1])**2); d['rg']=n['rg']
    return D
